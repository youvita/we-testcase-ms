import { isAdmin } from "@/lib/permissions";

/**
 * What the PO has answered on a case, and what is still to be put into it.
 *
 * A thread asks the PO when it is a question, or a comment from QA or a
 * developer that the PO replied to. The PO's replies are its answers. Once
 * the PO answers, QA should put the answer into the case's text — testers,
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
  author: { role: string };
};

const time = (value: Date | string) => new Date(value).getTime();

/** Whether a post starts a thread the PO's replies answer. */
function asksThePo(comment: ThreadComment): boolean {
  if (comment.deletedAt || comment.answerToId) return false;
  return comment.kind === "QUESTION" || (comment.kind === "COMMENT" && !isAdmin(comment.author.role));
}

/** Thread id → the PO's answers in it, oldest first. */
export function poAnswers<T extends ThreadComment>(comments: T[]): Map<string, T[]> {
  const roots = new Map(comments.filter(asksThePo).map((comment) => [comment.id, comment]));
  const answers = new Map<string, T[]>();
  for (const comment of comments) {
    if (!comment.answerToId || comment.deletedAt || !roots.has(comment.answerToId)) continue;
    if (comment.kind !== "ANSWER" && !isAdmin(comment.author.role)) continue;
    answers.set(comment.answerToId, [...(answers.get(comment.answerToId) ?? []), comment]);
  }
  for (const list of answers.values()) list.sort((a, b) => time(a.createdAt) - time(b.createdAt));
  return answers;
}

/** Thread id → its latest answer's id, for threads still to deal with. */
export function answersToApply(comments: ThreadComment[]): Map<string, string> {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const pending = new Map<string, string>();
  for (const [rootId, answers] of poAnswers(comments)) {
    const latest = answers.at(-1)!;
    const root = byId.get(rootId)!;
    if (root.settledAt && time(root.settledAt) >= time(latest.createdAt)) continue;
    pending.set(rootId, latest.id);
  }
  return pending;
}
