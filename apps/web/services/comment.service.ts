import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound } from "@/lib/api";
import { isAdmin } from "@/lib/permissions";
import type { Role } from "@/lib/constants";
import type { CommentWithAuthor } from "@/types";
import type { CommentInput } from "@wetestcase/dto";

import { deleteCommentAttachments, withFiles, type PreparedFile } from "./attachment.service";
import { answerQuestion, listAdmins } from "./clarification.service";
import { telegramCommentPosted } from "./telegram.service";

const authorSelect = {
  select: { id: true, name: true, email: true, image: true, role: true },
} as const;

/**
 * Oldest first — a discussion reads top to bottom.
 *
 * Deleted posts come back as tombstones with an empty body: the row is kept so
 * replies still make sense, but the text is dropped here rather than in the UI,
 * so it never reaches the browser at all.
 */
export async function listComments(
  testCaseId: string,
): Promise<CommentWithAuthor[]> {
  const comments = await prisma.comment.findMany({
    where: { testCaseId },
    orderBy: { createdAt: "asc" },
    include: {
      author: authorSelect,
      deletedBy: { select: { id: true, name: true } },
      questionTo: { select: { id: true, name: true } },
      settledBy: { select: { id: true, name: true } },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });

  return comments.map((comment) =>
    comment.deletedAt ? { ...comment, body: "", attachments: [] } : comment,
  );
}

const postInclude = {
  author: authorSelect,
  deletedBy: { select: { id: true, name: true } },
  questionTo: { select: { id: true, name: true } },
  attachments: true,
} as const;

/**
 * Post to a case's discussion — kept to one box:
 *
 *  - A question for the PO (`question`) goes to the same people as a
 *    comment; the PO's reply to it is its answer.
 *  - A new comment goes to the project's product owner — or, for a project
 *    without one yet, to every active admin. One from an admin goes the
 *    other way, to the people working on the case (see `workingOn`).
 *  - A reply sits under the comment it answers — one level: replying to a
 *    reply puts it under the same comment — and everyone already in that
 *    thread is notified. An admin replying to a question is its answer.
 */
export async function postComment(
  testCaseId: string,
  author: { id: string; role: Role },
  input: CommentInput,
  files: PreparedFile[] = [],
): Promise<CommentWithAuthor> {
  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: {
      id: true,
      projectId: true,
      project: { select: { productOwnerId: true, members: { select: { userId: true } } } },
      executions: { orderBy: { executedAt: "desc" }, take: 1, select: { testerId: true } },
      comments: { where: { deletedAt: null }, select: { authorId: true } },
    },
  });
  if (!testCase) throw notFound("Test case");

  if (input.replyToId) {
    return reply(testCaseId, testCase.projectId, author, input.replyToId, input.body, files);
  }

  const recipients = isAdmin(author.role)
    ? workingOn(testCase)
    : testCase.project.productOwnerId
      ? [testCase.project.productOwnerId]
      : (await listAdmins()).map((admin) => admin.id);
  // A question is for the PO: an admin is the one who answers, not asks.
  const question = Boolean(input.question) && !isAdmin(author.role);
  const saved = await withFiles(testCase.projectId, files, (attachments) => prisma.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        testCaseId,
        authorId: author.id,
        body: input.body,
        kind: question ? "QUESTION" : "COMMENT",
        attachments: { create: attachments },
      },
      include: postInclude,
    });
    await tx.notification.createMany({
      data: recipients
        .filter((id) => id !== author.id)
        .map((recipientId) => ({
          kind: question ? ("QUESTION_ASKED" as const) : ("COMMENT_POSTED" as const),
          recipientId,
          actorId: author.id,
          testCaseId,
          commentId: comment.id,
        })),
    });
    return comment;
  }));
  telegramCommentPosted(saved.id);
  return saved;
}

/**
 * Who an admin's new comment is for: whoever last ran the case and everyone
 * who has posted on it — or, while nobody has, the project's people in charge.
 */
function workingOn(testCase: {
  project: { members: { userId: string }[] };
  executions: { testerId: string }[];
  comments: { authorId: string }[];
}): string[] {
  const people = new Set([
    ...testCase.executions.map((run) => run.testerId),
    ...testCase.comments.map((comment) => comment.authorId),
  ]);
  if (people.size === 0) testCase.project.members.forEach((member) => people.add(member.userId));
  return [...people];
}

async function reply(
  testCaseId: string,
  projectId: string,
  author: { id: string; role: Role },
  replyToId: string,
  body: string,
  files: PreparedFile[],
): Promise<CommentWithAuthor> {
  const target = await prisma.comment.findUnique({
    where: { id: replyToId },
    select: { testCaseId: true, answerToId: true },
  });
  if (!target || target.testCaseId !== testCaseId) throw notFound("Comment");
  const root = await prisma.comment.findUniqueOrThrow({
    where: { id: target.answerToId ?? replyToId },
    select: {
      id: true,
      kind: true,
      authorId: true,
      deletedAt: true,
      questionToId: true,
      answers: { where: { deletedAt: null }, select: { authorId: true } },
    },
  });
  if (root.deletedAt) throw badRequest("That comment was deleted — post a new one instead.");

  // The PO replying to a question answers it, with the answer's own flow.
  if (root.kind === "QUESTION" && isAdmin(author.role)) {
    const answer = await answerQuestion(root.id, author, body, files);
    return prisma.comment.findUniqueOrThrow({ where: { id: answer.id }, include: postInclude });
  }

  const thread = new Set([root.authorId, ...root.answers.map((answer) => answer.authorId)]);
  if (root.questionToId) thread.add(root.questionToId);
  thread.delete(author.id);

  const saved = await withFiles(projectId, files, (attachments) => prisma.$transaction(async (tx) => {
    const posted = await tx.comment.create({
      data: { testCaseId, authorId: author.id, body, answerToId: root.id, attachments: { create: attachments } },
      include: postInclude,
    });
    await tx.notification.createMany({
      data: [...thread].map((recipientId) => ({
        kind: "COMMENT_REPLIED" as const,
        recipientId,
        actorId: author.id,
        testCaseId,
        commentId: posted.id,
      })),
    });
    // Replying acts on what came before in the thread: that is read now.
    await tx.notification.updateMany({
      where: { recipientId: author.id, readAt: null, comment: { OR: [{ id: root.id }, { answerToId: root.id }] } },
      data: { readAt: new Date() },
    });
    return posted;
  }));
  telegramCommentPosted(saved.id);
  return saved;
}

/**
 * Withdraw a comment.
 *
 * A soft delete, not a real one: later posts reply to earlier ones, and pulling
 * a row out would leave answers to a question nobody can see. The entry stays
 * in place as a tombstone showing who withdrew it and when.
 *
 * Authors may withdraw their own; admins may withdraw anyone's. QA cannot
 * remove a developer's reply and vice versa — the discussion is a shared record.
 */
export async function deleteComment(
  commentId: string,
  actor: { id: string; role: Role },
) {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true, deletedAt: true },
  });
  if (!comment) throw notFound("Comment");

  if (comment.authorId !== actor.id && !isAdmin(actor.role)) {
    throw forbidden("You can only delete your own comments");
  }
  if (comment.deletedAt) return;

  await prisma.comment.update({
    where: { id: commentId },
    data: { deletedAt: new Date(), deletedById: actor.id },
  });
  // Its files go with it: nobody can open them any more.
  await deleteCommentAttachments(commentId);
}
