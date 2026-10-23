import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { PLATFORM_LABELS } from "@/lib/constants";
import { isAutomatablePlatform } from "@wetestcase/dto";

/**
 * The Playwright script behind a test case. One per case; the run keeps its
 * own copy of what it executed, so editing here never rewrites history.
 */

export async function getAutomationScript(testCaseId: string) {
  return prisma.automationScript.findUnique({
    where: { testCaseId },
    select: {
      code: true,
      updatedAt: true,
      verifiedAt: true,
      updatedBy: { select: { id: true, name: true } },
    },
  });
}

/**
 * Save a case's script.
 *
 * A changed script is a draft again until it passes: what was proven was
 * the old code. `verified` is for a script known to have just passed — one
 * Claude wrote and saw go green.
 */
export async function saveAutomationScript(
  testCaseId: string,
  userId: string,
  code: string,
  options: { verified?: boolean } = {},
) {
  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { platform: true },
  });
  if (!testCase) throw notFound("Test case");
  if (!isAutomatablePlatform(testCase.platform)) {
    throw badRequest(
      `${PLATFORM_LABELS[testCase.platform]} cases cannot be automated yet — the runner handles Web and API.`,
    );
  }

  const existing = await prisma.automationScript.findUnique({
    where: { testCaseId },
    select: { code: true, verifiedAt: true },
  });
  const verifiedAt = options.verified
    ? new Date()
    : existing && existing.code === code
      ? existing.verifiedAt
      : null;

  return prisma.automationScript.upsert({
    where: { testCaseId },
    create: { testCaseId, code, updatedById: userId, verifiedAt },
    update: { code, updatedById: userId, verifiedAt },
    select: {
      code: true,
      updatedAt: true,
      verifiedAt: true,
      updatedBy: { select: { id: true, name: true } },
    },
  });
}

/** QA vouches for a draft script without waiting for it to pass. */
export async function verifyAutomationScript(testCaseId: string) {
  const { count } = await prisma.automationScript.updateMany({
    where: { testCaseId },
    data: { verifiedAt: new Date() },
  });
  if (count === 0) throw notFound("Script");
}

/**
 * A passing run proves the case's script — if what ran is that script. A run
 * item's code may carry a "sign in first" prefix ahead of it.
 */
export async function verifyIfRanCurrentScript(testCaseId: string, ranCode: string) {
  const script = await prisma.automationScript.findUnique({
    where: { testCaseId },
    select: { code: true, verifiedAt: true },
  });
  if (!script || script.verifiedAt) return false;
  if (ranCode !== script.code && !ranCode.endsWith(`\n${script.code}`)) return false;
  await prisma.automationScript.update({
    where: { testCaseId },
    data: { verifiedAt: new Date() },
  });
  return true;
}

export async function deleteAutomationScript(testCaseId: string) {
  await prisma.automationScript.deleteMany({ where: { testCaseId } });
}

/** Titles that look like a sign-in, in the languages these projects use. */
const SIGN_IN_TITLE = /log\s?-?in|sign\s?-?in|đăng nhập|ចូល|로그인/i;

/**
 * Automated Web cases — any of them can sign in before others run or
 * explore. Ones whose title reads like a login come first: they are what
 * "sign in first" almost always wants.
 */
export async function listSignInCases(projectId: string) {
  const cases = await prisma.testCase.findMany({
    where: { projectId, platform: "WEB", script: { isNot: null } },
    orderBy: { tcId: "asc" },
    select: { id: true, tcId: true, title: true },
  });
  return [
    ...cases.filter((c) => SIGN_IN_TITLE.test(c.title)),
    ...cases.filter((c) => !SIGN_IN_TITLE.test(c.title)),
  ];
}
