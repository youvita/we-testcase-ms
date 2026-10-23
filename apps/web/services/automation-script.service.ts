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
      updatedBy: { select: { id: true, name: true } },
    },
  });
}

export async function saveAutomationScript(
  testCaseId: string,
  userId: string,
  code: string,
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

  return prisma.automationScript.upsert({
    where: { testCaseId },
    create: { testCaseId, code, updatedById: userId },
    update: { code, updatedById: userId },
    select: {
      code: true,
      updatedAt: true,
      updatedBy: { select: { id: true, name: true } },
    },
  });
}

export async function deleteAutomationScript(testCaseId: string) {
  await prisma.automationScript.deleteMany({ where: { testCaseId } });
}
