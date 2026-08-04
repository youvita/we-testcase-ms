import { prisma } from "@/lib/prisma";
import { forbidden, notFound } from "@/lib/api";
import { isAdmin } from "@/lib/permissions";
import type { Role } from "@/lib/constants";
import type { CommentWithAuthor } from "@/types";

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
    },
  });

  return comments.map((comment) =>
    comment.deletedAt ? { ...comment, body: "" } : comment,
  );
}

export async function createComment(
  testCaseId: string,
  authorId: string,
  body: string,
): Promise<CommentWithAuthor> {
  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { id: true },
  });
  if (!testCase) throw notFound("Test case");

  return prisma.comment.create({
    data: { testCaseId, authorId, body },
    include: {
      author: authorSelect,
      deletedBy: { select: { id: true, name: true } },
    },
  });
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
}
