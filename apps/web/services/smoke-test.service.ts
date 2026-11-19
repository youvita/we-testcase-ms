import {
  AUTOMATABLE_PLATFORMS,
  looksLikeSignIn,
  type SmokeTestDto,
  type SmokeTestInput,
  type TestRunDto,
} from "@wetestcase/dto";

import { HttpError, badRequest, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";

import { createTestRun } from "./test-run.service";

/**
 * A project's smoke test: the automated cases QA picks to check the basics
 * after a deploy, run one at a time in the order QA set — every case, even
 * after one fails — without recording results on the cases.
 */

export async function getSmokeTest(projectId: string): Promise<SmokeTestDto> {
  const [project, cases] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { smokeSignInTestCaseId: true } }),
    prisma.testCase.findMany({
      where: { projectId, smokePosition: { not: null } },
      orderBy: { smokePosition: "asc" },
      select: {
        id: true,
        tcId: true,
        title: true,
        platform: true,
        module: { select: { name: true } },
        script: { select: { testCaseId: true } },
      },
    }),
  ]);
  if (!project) throw notFound("Project");
  return {
    signInTestCaseId: project.smokeSignInTestCaseId,
    cases: cases.map((c) => ({
      id: c.id,
      tcId: c.tcId,
      title: c.title,
      platform: c.platform,
      module: c.module.name,
      hasScript: Boolean(c.script),
    })),
  };
}

/** Replace the smoke test with these cases, in this order. */
export async function saveSmokeTest(projectId: string, input: SmokeTestInput): Promise<SmokeTestDto> {
  const ids = input.testCaseIds;
  const found = await prisma.testCase.findMany({
    where: { projectId, id: { in: ids }, platform: { in: [...AUTOMATABLE_PLATFORMS] } },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    throw badRequest("Only this project's Web and API cases can be in its smoke test.");
  }

  const signInId = input.signInTestCaseId ?? null;
  if (signInId) {
    const signIn = await prisma.testCase.findFirst({
      where: { id: signInId, projectId, platform: "WEB", script: { isNot: null } },
      select: { id: true },
    });
    if (!signIn) throw badRequest("The sign-in case needs a Web automation script.");
  }

  await prisma.$transaction([
    prisma.testCase.updateMany({
      where: { projectId, smokePosition: { not: null } },
      data: { smokePosition: null },
    }),
    ...ids.map((id, position) =>
      prisma.testCase.update({ where: { id }, data: { smokePosition: position } }),
    ),
    prisma.project.update({ where: { id: projectId }, data: { smokeSignInTestCaseId: signInId } }),
  ]);
  return getSmokeTest(projectId);
}

/**
 * Start the smoke test against the chosen environment — or the project's
 * default (or its only one): in order, every case, signed in once, nothing
 * recorded.
 *
 * Who signs in: the case QA chose; with none chosen, the first login case in
 * the list. With neither, the Web cases would start signed out, so the run is
 * refused with a 409 that says so, unless QA chose to run anyway.
 */
export async function runSmokeTest(
  projectId: string,
  userId: string,
  options: { environmentId?: string; withoutSignIn?: boolean } = {},
): Promise<TestRunDto> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      defaultEnvironmentId: true,
      smokeSignInTestCaseId: true,
      runEnvironments: { select: { id: true }, orderBy: { name: "asc" } },
    },
  });
  if (!project) throw notFound("Project");

  // A chosen one is checked against the project when the run is created.
  const environmentId =
    options.environmentId ??
    project.defaultEnvironmentId ??
    (project.runEnvironments.length === 1 ? project.runEnvironments[0]!.id : null);
  if (!environmentId) {
    throw badRequest(
      project.runEnvironments.length === 0
        ? "This project has no environment to run against. Add one in Environments."
        : "Set the project's default environment first — the smoke test runs against it.",
    );
  }

  let signInId = project.smokeSignInTestCaseId;
  if (!signInId) {
    const webCases = await prisma.testCase.findMany({
      where: { projectId, smokePosition: { not: null }, platform: "WEB", script: { isNot: null } },
      orderBy: { smokePosition: "asc" },
      select: { id: true, title: true },
    });
    signInId = webCases.find((c) => looksLikeSignIn(c.title))?.id ?? null;
    if (!signInId && webCases.length > 0 && !options.withoutSignIn) {
      throw new HttpError(
        409,
        `No sign-in case is chosen, and no case in the smoke test logs in. ${
          webCases.length === 1 ? "Its Web case starts" : `Its ${webCases.length} Web cases start`
        } signed out, so any that need a login will fail. Choose a sign-in case, or add a login case to the list.`,
      );
    }
  }

  return createTestRun(
    projectId,
    userId,
    {
      environmentId,
      scope: "cases",
      recordResults: false,
      setupTestCaseId: signInId ?? undefined,
      signInOnce: true,
      inOrder: true,
      liveView: false,
      speed: "normal",
    },
    { smoke: true },
  );
}
