import type { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";

import { notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

/**
 * Who may open a project at all.
 *
 * Membership, not role, answers this one. `lib/permissions.ts` says what a role
 * may *do* once inside; this says which projects they are inside of. Both have
 * to pass — being in charge of a project does not let a Developer edit its test
 * cases, and being QA does not let them read a project they are not on.
 *
 * Access is granted to:
 *  - the QA owner,
 *  - everyone listed as in charge (`ProjectMember`),
 *  - the person who created it — otherwise a QA who forgets to add themselves
 *    loses the project they just made,
 *  - every Admin, by role. Admins are deliberately not required to be members:
 *    someone has to be able to reach a project whose owner has left, and an
 *    Admin already administers accounts and deletes projects.
 *
 * A user who fails all of these is told the project does not exist rather than
 * that they are not allowed in, so project ids stay unguessable.
 */
export type ProjectAccessRow = {
  qaOwnerId: string | null;
  createdById: string;
  members: { userId: string }[];
};

/** Decide access for a project row that has already been loaded. */
export function canAccessProject(
  project: ProjectAccessRow,
  user: SessionUser,
): boolean {
  if (isAdmin(user.role)) return true;
  if (project.qaOwnerId === user.id) return true;
  if (project.createdById === user.id) return true;
  return project.members.some((member) => member.userId === user.id);
}

/**
 * The same rule as a query filter, for listing.
 *
 * Returns `{}` for an Admin so the caller can spread it unconditionally.
 */
export function projectAccessWhere(
  user: SessionUser,
): Prisma.ProjectWhereInput {
  if (isAdmin(user.role)) return {};
  return {
    OR: [
      { qaOwnerId: user.id },
      { createdById: user.id },
      { members: { some: { userId: user.id } } },
    ],
  };
}

const accessSelect = {
  qaOwnerId: true,
  createdById: true,
  members: { select: { userId: true } },
} as const;

/**
 * Non-throwing check, for places that must degrade rather than fail —
 * `generateMetadata` above all, which runs before the page redirects and would
 * otherwise put the project's name in the browser tab of someone who cannot
 * open it.
 */
export async function hasProjectAccess(
  projectId: string,
  user: SessionUser | null,
): Promise<boolean> {
  if (!user) return false;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: accessSelect,
  });
  return Boolean(project && canAccessProject(project, user));
}

/** As above, for a test case — its title is as revealing as the project's name. */
export async function hasTestCaseAccess(
  testCaseId: string,
  user: SessionUser | null,
): Promise<boolean> {
  if (!user) return false;
  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { project: { select: accessSelect } },
  });
  return Boolean(testCase && canAccessProject(testCase.project, user));
}

/**
 * Assert access from an API route. Throws the same 404 for "no such project"
 * and "not yours".
 */
export async function assertProjectAccess(
  projectId: string,
  user: SessionUser,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: accessSelect,
  });
  if (!project) throw notFound("Project");
  if (!canAccessProject(project, user)) throw notFound("Project");
}

/**
 * Assert access to whatever project a test case belongs to.
 *
 * Test-case, execution and comment routes are keyed by their own id, so without
 * this a non-member holding an id could still read or change a case in a project
 * they cannot open.
 */
export async function assertTestCaseAccess(
  testCaseId: string,
  user: SessionUser,
): Promise<void> {
  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { project: { select: accessSelect } },
  });
  if (!testCase) throw notFound("Test case");
  if (!canAccessProject(testCase.project, user)) throw notFound("Test case");
}

/** As above, for a module id. */
export async function assertModuleAccess(
  moduleId: string,
  user: SessionUser,
): Promise<void> {
  const found = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { project: { select: accessSelect } },
  });
  if (!found) throw notFound("Module");
  if (!canAccessProject(found.project, user)) throw notFound("Module");
}

/** As above, for an execution id. */
export async function assertExecutionAccess(
  executionId: string,
  user: SessionUser,
): Promise<void> {
  const found = await prisma.testExecution.findUnique({
    where: { id: executionId },
    select: { testCase: { select: { project: { select: accessSelect } } } },
  });
  if (!found) throw notFound("Execution");
  if (!canAccessProject(found.testCase.project, user)) {
    throw notFound("Execution");
  }
}

/**
 * As above, for an attachment id.
 *
 * Screenshots and videos are stored outside /public and served through a route
 * precisely so this check can exist — being signed in is not enough when the
 * evidence belongs to a project the viewer is not on.
 */
export async function assertAttachmentAccess(
  attachmentId: string,
  user: SessionUser,
): Promise<void> {
  const found = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      execution: {
        select: { testCase: { select: { project: { select: accessSelect } } } },
      },
    },
  });
  if (!found) throw notFound("Attachment");
  if (!canAccessProject(found.execution.testCase.project, user)) {
    throw notFound("Attachment");
  }
}

/** As above, for a comment id. */
export async function assertCommentAccess(
  commentId: string,
  user: SessionUser,
): Promise<void> {
  const found = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { testCase: { select: { project: { select: accessSelect } } } },
  });
  if (!found) throw notFound("Comment");
  if (!canAccessProject(found.testCase.project, user)) {
    throw notFound("Comment");
  }
}

/**
 * Access guard for a server page.
 *
 * Redirects to /forbidden rather than throwing, matching `requireRole`: the
 * user is signed in and the page needs to say so.
 */
export async function requireProjectAccess(
  projectId: string,
  user: SessionUser,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: accessSelect,
  });
  if (!project) redirect("/projects");
  if (!canAccessProject(project, user)) redirect("/forbidden");
}
