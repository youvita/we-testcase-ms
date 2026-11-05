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
