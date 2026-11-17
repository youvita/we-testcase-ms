import { prisma } from "@/lib/prisma";
import { mentionedUsernames, type MentionablePerson } from "@/utils/mentions";
import { shownUsername } from "@/utils/username";

/** Active people who can open the project: only they can read the post. */
function canOpen(projectId: string) {
  return {
    isActive: true,
    username: { not: null },
    OR: [
      { role: "ADMIN" as const },
      { ownedProjects: { some: { id: projectId } } },
      { createdProjects: { some: { id: projectId } } },
      { projectRoles: { some: { projectId } } },
    ],
  };
}

export async function listMentionable(projectId: string): Promise<MentionablePerson[]> {
  const people = await prisma.user.findMany({
    where: canOpen(projectId),
    orderBy: { name: "asc" },
    select: { id: true, name: true, username: true, displayUsername: true, image: true, role: true },
  });
  return people.map((person) => ({
    id: person.id,
    name: person.name,
    username: shownUsername(person.username, person.displayUsername)!,
    image: person.image,
    role: person.role,
  }));
}

/**
 * Tell the people a post @mentions — those who can open its project, never
 * its author. "Mentioned you" replaces the plainer "commented on"/"replied
 * on" they would get for the same post; a question or an answer keeps its own.
 *
 * After an edit (`previousBody`), only the people newly mentioned.
 */
export async function notifyMentions(commentId: string, previousBody?: string): Promise<void> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { body: true, authorId: true, testCaseId: true, deletedAt: true, testCase: { select: { projectId: true } } },
  });
  if (!comment || comment.deletedAt) return;

  const before = new Set(previousBody ? mentionedUsernames(previousBody) : []);
  const names = mentionedUsernames(comment.body).filter((name) => !before.has(name));
  if (names.length === 0) return;

  const people = await prisma.user.findMany({
    where: { ...canOpen(comment.testCase.projectId), username: { in: names }, NOT: { id: comment.authorId } },
    select: { id: true },
  });
  const ids = people.map((person) => person.id);
  if (ids.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.notification.deleteMany({
      where: { commentId, recipientId: { in: ids }, kind: { in: ["COMMENT_POSTED", "COMMENT_REPLIED"] } },
    });
    const kept = await tx.notification.findMany({
      where: { commentId, recipientId: { in: ids } },
      select: { recipientId: true },
    });
    const told = new Set(kept.map((row) => row.recipientId));
    await tx.notification.createMany({
      data: ids
        .filter((id) => !told.has(id))
        .map((recipientId) => ({
          kind: "COMMENT_MENTIONED" as const,
          recipientId,
          actorId: comment.authorId,
          testCaseId: comment.testCaseId,
          commentId,
        })),
    });
  });
}
