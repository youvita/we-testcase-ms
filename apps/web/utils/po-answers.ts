/**
 * Questions on a case whose PO answer has not yet been dealt with.
 *
 * Once the PO answers, QA should put the answer into the case's text — testers,
 * reports and the AI all read the case, not the chat — or say it needs no
 * change. A newer answer than that asks again.
 */
type ThreadComment = {
  id: string;
  kind: "COMMENT" | "QUESTION" | "ANSWER";
  answerToId: string | null;
  createdAt: Date | string;
  deletedAt: Date | string | null;
  settledAt: Date | string | null;
};

const time = (value: Date | string) => new Date(value).getTime();

/** Question id → its latest answer's id, for questions still to deal with. */
export function answersToApply(comments: ThreadComment[]): Map<string, string> {
  const latest = new Map<string, ThreadComment>();
  for (const comment of comments) {
    if (comment.kind !== "ANSWER" || !comment.answerToId || comment.deletedAt) continue;
    const seen = latest.get(comment.answerToId);
    if (!seen || time(comment.createdAt) >= time(seen.createdAt)) latest.set(comment.answerToId, comment);
  }
  const pending = new Map<string, string>();
  for (const comment of comments) {
    if (comment.kind !== "QUESTION" || comment.deletedAt) continue;
    const answer = latest.get(comment.id);
    if (!answer) continue;
    if (comment.settledAt && time(comment.settledAt) >= time(answer.createdAt)) continue;
    pending.set(comment.id, answer.id);
  }
  return pending;
}
