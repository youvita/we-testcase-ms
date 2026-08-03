import { ROLES, type Role } from "@/lib/constants";

/**
 * Single source of truth for "who may do what".
 *
 * Every API route and every server page derives its access decision from these
 * helpers rather than comparing role strings inline, so the read-only Developer
 * guarantee is enforced in exactly one place.
 */

export function isAdmin(role: Role | string | undefined | null): boolean {
  return role === ROLES.ADMIN;
}

export function isQA(role: Role | string | undefined | null): boolean {
  return role === ROLES.QA;
}

export function isDeveloper(role: Role | string | undefined | null): boolean {
  return role === ROLES.DEVELOPER;
}

/** Create/rename/delete projects and modules. */
export function canManageProjects(role: Role | string | undefined | null) {
  return isAdmin(role) || isQA(role);
}

/** Import Excel, create/edit/delete test cases. */
export function canManageTestCases(role: Role | string | undefined | null) {
  return isAdmin(role) || isQA(role);
}

/** Record an execution result, comment, or screenshot. */
export function canExecuteTests(role: Role | string | undefined | null) {
  return isAdmin(role) || isQA(role);
}

/**
 * Join the discussion on a test case.
 *
 * Open to every signed-in role — a comment is a conversation, not a result, so
 * it does not touch the execution audit trail the Developer restriction exists
 * to protect.
 */
export function canComment(role: Role | string | undefined | null) {
  return isAdmin(role) || isQA(role) || isDeveloper(role);
}

/**
 * Set the developer's side of the triage state — investigating, fix ready,
 * won't fix, not a bug.
 *
 * QA is excluded from these: they exist so engineering can answer a failure
 * without editing the test result, and letting QA set them too would blur the
 * line they draw.
 */
export function canSetFixStatus(role: Role | string | undefined | null) {
  return isAdmin(role) || isDeveloper(role);
}

/**
 * Claim a case as being retested.
 *
 * QA's own step in the hand-off, and only theirs: a developer cannot know that
 * someone has started re-running the case. It says nothing about the outcome —
 * recording the execution does that, and clears this back to none.
 */
export function canMarkRetesting(role: Role | string | undefined | null) {
  return isAdmin(role) || isQA(role);
}

/** Download Excel/PDF reports. Developers may read reports too. */
export function canExportReports(role: Role | string | undefined | null) {
  return isAdmin(role) || isQA(role) || isDeveloper(role);
}

/** Manage user accounts and role assignment. */
export function canManageUsers(role: Role | string | undefined | null) {
  return isAdmin(role);
}

/** Everyone signed in may read test data. */
export function canViewTestData(role: Role | string | undefined | null) {
  return isAdmin(role) || isQA(role) || isDeveloper(role);
}
