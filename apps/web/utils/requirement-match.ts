/**
 * Telling whether a requirement read from a new version of a document is one
 * the project already has, and whether its text changed.
 *
 * Codes decide first (see requirement.service.ts). This is for when they do
 * not: a document without its own identifiers gets codes the AI makes up, and
 * those can differ between readings. Similarity is over character pairs, not
 * words, so it works for text that is not split by spaces (Khmer, Thai) as
 * well as for English or Korean.
 */

export type MatchableText = {
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
};

/** At or above this, with a clear lead over the runner-up, it is the same requirement. */
export const SAME_SCORE = 0.8;
/** The best candidate must beat the next by this much to be taken as the same. */
export const SAME_MARGIN = 0.1;
/** At or above this it is worth asking QA; below, it is a new requirement. */
export const ASK_SCORE = 0.5;

/** Case, punctuation, bullets and spacing do not count as a change. */
export function normalizeText(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(text: string): Map<string, number> {
  const compact = text.replace(/ /g, "");
  const counts = new Map<string, number>();
  for (let i = 0; i < compact.length - 1; i += 1) {
    const pair = compact.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Dice coefficient over character pairs: 1 for the same text, 0 for nothing shared. */
export function textSimilarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (x === y) return x ? 1 : 0;
  const pairsA = bigrams(x);
  const pairsB = bigrams(y);
  let total = 0;
  for (const count of pairsA.values()) total += count;
  for (const count of pairsB.values()) total += count;
  if (total === 0) return 0;
  let shared = 0;
  for (const [pair, count] of pairsA) shared += Math.min(count, pairsB.get(pair) ?? 0);
  return (2 * shared) / total;
}

function body(item: MatchableText): string {
  return [item.description, item.acceptanceCriteria].filter(Boolean).join("\n");
}

/** How alike two requirements are, weighting the title over the details. */
export function requirementSimilarity(a: MatchableText, b: MatchableText): number {
  const title = textSimilarity(a.title, b.title);
  const bodyA = body(a);
  const bodyB = body(b);
  if (!bodyA || !bodyB) return title;
  return 0.6 * title + 0.4 * textSimilarity(bodyA, bodyB);
}

/** Whether the text a tester works from is the same, ignoring formatting. */
export function sameRequirementText(a: MatchableText, b: MatchableText): boolean {
  return (
    normalizeText(a.title) === normalizeText(b.title) &&
    normalizeText(a.description) === normalizeText(b.description) &&
    normalizeText(a.acceptanceCriteria) === normalizeText(b.acceptanceCriteria)
  );
}

export type MatchVerdict<T> =
  | { kind: "same"; candidate: T; score: number }
  | { kind: "ask"; candidate: T; score: number }
  | { kind: "new" };

/** The closest candidate, and whether it is close enough to assume or to ask about. */
export function findMatch<T extends MatchableText>(
  item: MatchableText,
  candidates: readonly T[],
): MatchVerdict<T> {
  let best: { candidate: T; score: number } | null = null;
  let second = 0;
  for (const candidate of candidates) {
    const score = requirementSimilarity(item, candidate);
    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { candidate, score };
    } else if (score > second) {
      second = score;
    }
  }
  if (!best || best.score < ASK_SCORE) return { kind: "new" };
  if (best.score >= SAME_SCORE && best.score - second >= SAME_MARGIN) {
    return { kind: "same", ...best };
  }
  return { kind: "ask", ...best };
}
