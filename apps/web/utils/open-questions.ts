/**
 * Open questions for the PO, out of a case's text and into their own field.
 *
 * The AI used to end an expected result with "(confirm with PO)", which left
 * the check unclear about what passes. Now it lists those gaps separately;
 * this is the net under that, and how drafts written before it are shown and
 * accepted.
 *
 * Only text the AI marked is touched. Within it, a sentence that names a gap
 * ("Exact wording is not specified") moves to the questions; a marked
 * sentence that is a real check stays where it is, without the marker, and
 * the question asks the PO to confirm it.
 */

type CaseText = {
  preconditions?: string | null;
  steps?: string | null;
  expectedResult?: string | null;
  openQuestions?: string | null;
};

/** "(confirm with PO)", "(assumption — confirm with PO)", "(confirm endpoint with dev)". */
const MARKER = /\s*\([^()]*?confirm\w*(?:\s+\w+)?\s+with\s+(?:the\s+)?(?:po|dev|developers?|product owner)\)/gi;
/**
 * A sentence that is itself the question: "Home page content is to be
 * confirmed with PO." Only the PO or developers count — "Confirm with Tab"
 * is a step.
 */
const MENTION = /\bconfirm\w*(?:\s+\w+)?\s+with\s+(?:the\s+)?(?:po|dev|developers?|product owner)\b/i;
const GAP =
  /\b(not specified|not stated|unspecified|not defined|undefined|unclear|unknown|not documented|tbd|to be confirmed|not given|not said)\b/i;

const hasMarker = (text: string) => new RegExp(MARKER.source, "i").test(text) || MENTION.test(text);
const stripMarker = (text: string) => text.replace(MARKER, "").replace(/\s+([.,;:])/g, "$1").trim();

export function splitOpenQuestions<T extends CaseText>(
  testCase: T,
): T & { openQuestions?: string | null } {
  const questions: string[] = [];
  const split = (text: string | null | undefined) => {
    if (!text || !hasMarker(text)) return text;
    return text
      .split("\n")
      .map((line) => {
        if (!hasMarker(line)) return line;
        // "3. Click Delete. The rule is unclear (confirm with PO)": the
        // number stays with what is left of the line.
        const number = /^\s*(\d+[.)]\s+|[-*]\s+)/.exec(line)?.[0] ?? "";
        const kept: string[] = [];
        // A marked sentence: a gap moves to the questions; a check stays and
        // the question asks to confirm it.
        const marked = (sentence: string, marker: string) => {
          if (GAP.test(sentence) || MENTION.test(sentence)) questions.push(withStop(sentence));
          else {
            kept.push(sentence);
            questions.push(`Confirm with ${whoConfirms(marker)}: ${withStop(sentence)}`);
          }
        };
        for (const sentence of line.slice(number.length).split(/(?<=[.!?])\s+/)) {
          const clean = stripMarker(sentence);
          if (!hasMarker(sentence)) {
            if (clean) kept.push(clean);
          } else if (clean) {
            marked(clean, sentence);
          } else if (kept.length) {
            // "… not an empty one. (confirm with PO)": the marker stands
            // alone and means the sentence before it.
            marked(kept.pop()!, sentence);
          }
        }
        return kept.length ? `${number}${kept.join(" ")}` : "";
      })
      .filter((line) => line.trim())
      .join("\n");
  };

  const result = {
    ...testCase,
    preconditions: split(testCase.preconditions),
    steps: split(testCase.steps),
    expectedResult: split(testCase.expectedResult),
  };
  if (!questions.length) return result;
  const existing = (testCase.openQuestions ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const all = [...existing, ...questions.map((question) => `- ${question}`)];
  return { ...result, openQuestions: [...new Set(all)].join("\n") };
}

/** The marker's own audience: "(confirm endpoint with dev)" is not for the PO. */
const whoConfirms = (marker: string) => (/with\s+(?:the\s+)?dev/i.test(marker) ? "the developers" : "the PO");
const withStop = (sentence: string) => (/[.!?]$/.test(sentence) ? sentence : `${sentence}.`);

// ---------------------------------------------------------------------------
// One home for each question. A case that verifies requirements keeps its
// open questions on them — the same list for every case verifying them, and
// where the PO reads the specification. A case with none keeps its own.
// ---------------------------------------------------------------------------

const BULLET = /^\s*(?:[-*•–]|\d+[.)])\s+/;

/** The questions in an open-questions text, one per line, without their bullets. */
export function questionLines(text: string | null | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.replace(BULLET, "").trim())
    .filter(Boolean);
}

/** The same question, however it is punctuated or capitalised. */
export const sameQuestion = (question: string) =>
  question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const asList = (questions: string[]) => (questions.length ? questions.map((q) => `- ${q}`).join("\n") : null);

/** Several lists as one, each question once, in the order they come. */
export function mergeQuestions(...texts: (string | null | undefined)[]): string | null {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const question of texts.flatMap(questionLines)) {
    const key = sameQuestion(question);
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(question);
    }
  }
  return asList(merged);
}

/**
 * A case's whole list, edited, back onto the requirements that hold it: each
 * keeps the questions still on the list, loses those taken off it, and the
 * first takes the new ones. A requirement whose questions did not change
 * keeps its text as it was written.
 */
export function distributeQuestions<Id extends string>(
  text: string | null | undefined,
  holders: { id: Id; text: string | null }[],
): Map<Id, string | null> {
  const wanted = new Map<string, string>();
  for (const question of questionLines(text)) {
    const key = sameQuestion(question);
    if (key && !wanted.has(key)) wanted.set(key, question);
  }
  const held = new Set<string>();
  const kept = holders.map((holder) => {
    const own = questionLines(holder.text);
    const keep = own.filter((question) => wanted.has(sameQuestion(question)));
    keep.forEach((question) => held.add(sameQuestion(question)));
    return { holder, own, keep };
  });
  const added = [...wanted].filter(([key]) => !held.has(key)).map(([, question]) => question);

  const result = new Map<Id, string | null>();
  kept.forEach(({ holder, own, keep }, index) => {
    const questions = index === 0 ? [...keep, ...added] : keep;
    const unchanged =
      questions.length === own.length && questions.every((q, i) => sameQuestion(q) === sameQuestion(own[i]!));
    result.set(holder.id, unchanged ? holder.text : asList(questions));
  });
  return result;
}

/** `holder` with the questions of `text` it does not ask yet, added after its own. */
export function addQuestions(holder: string | null | undefined, text: string | null | undefined): string | null {
  const have = new Set(questionLines(holder).map(sameQuestion));
  const added = questionLines(text).filter((question) => {
    const key = sameQuestion(question);
    if (!key || have.has(key)) return false;
    have.add(key);
    return true;
  });
  if (!added.length) return holder?.trim() ? holder : null;
  return [holder?.trim(), asList(added)].filter(Boolean).join("\n");
}

/**
 * A case's open questions as one list — its own and those of the
 * requirements it verifies — and the codes of the requirements they are kept
 * on (none: kept on the case).
 */
export function caseQuestions(
  own: string | null | undefined,
  requirements: { code: string; openQuestions: string | null }[],
): { text: string | null; keptOn: string[] } {
  return {
    text: mergeQuestions(own, ...requirements.map((requirement) => requirement.openQuestions)),
    keptOn: requirements.map((requirement) => requirement.code),
  };
}

/** The note under a case's open questions, saying where they are kept. */
export function keptOnNote(keptOn: string[]): string | null {
  if (keptOn.length === 0) return null;
  return `Kept on requirement${keptOn.length > 1 ? "s" : ""} ${keptOn.join(", ")} — shared with every test case that verifies ${keptOn.length > 1 ? "them" : "it"}.`;
}

/**
 * The questions of an open-questions list that a question put to the PO
 * asked — its lines name them, as "Ask the PO" filled them in.
 */
export function askedQuestions(open: string | null | undefined, asked: string): string[] {
  const askedKeys = questionLines(asked).map(sameQuestion).filter(Boolean);
  return questionLines(open).filter((question) => {
    const key = sameQuestion(question);
    return Boolean(key) && askedKeys.some((line) => line === key || line.includes(key) || key.includes(line));
  });
}

/** A list without these questions; null once none is left. */
export function withoutQuestions(text: string | null | undefined, remove: string[]): string | null {
  const gone = new Set(remove.map(sameQuestion));
  const lines = questionLines(text);
  const left = lines.filter((question) => !gone.has(sameQuestion(question)));
  if (left.length === lines.length) return text?.trim() ? text : null;
  return asList(left);
}
