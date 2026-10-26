import JSZip from "jszip";

import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import {
  fileName,
  projectFiles,
  singleSpecFile,
  type ExportCase,
} from "@/lib/script-export";

import { listRunEnvironments } from "./run-environment.service";

const caseSelect = {
  id: true,
  tcId: true,
  title: true,
  platform: true,
  subModule: true,
  projectId: true,
  module: { select: { name: true } },
  script: { select: { code: true } },
} as const;

/**
 * The environment whose URLs and plain variables fill the example settings:
 * the one asked for, else the first. Secret values are never included.
 */
async function pickEnvironment(projectId: string, environmentId?: string) {
  const environments = await listRunEnvironments(projectId);
  return environments.find((env) => env.id === environmentId) ?? environments[0] ?? null;
}

/** One case's script as a runnable .spec.ts. */
export async function exportCaseScript(testCaseId: string, environmentId?: string) {
  const row = await prisma.testCase.findUnique({ where: { id: testCaseId }, select: caseSelect });
  if (!row) throw notFound("Test case");
  if (!row.script || (row.platform !== "WEB" && row.platform !== "API")) {
    throw badRequest("This test case has no automation script to download.");
  }
  const testCase: ExportCase = {
    tcId: row.tcId,
    title: row.title,
    platform: row.platform,
    moduleName: row.module.name,
    subModule: row.subModule,
    code: row.script.code,
  };
  return {
    fileName: fileName(testCase),
    content: singleSpecFile(testCase, await pickEnvironment(row.projectId, environmentId)),
  };
}

/**
 * Scripts as a Playwright project in a .zip — the chosen cases, or every
 * automated case in the project when none are chosen.
 */
export async function exportProjectScripts(
  projectId: string,
  options: { testCaseIds?: string[]; environmentId?: string } = {},
) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) throw notFound("Project");

  const rows = await prisma.testCase.findMany({
    where: {
      projectId,
      platform: { in: ["WEB", "API"] },
      script: { isNot: null },
      ...(options.testCaseIds?.length ? { id: { in: options.testCaseIds } } : {}),
    },
    orderBy: [
      { module: { position: "asc" } },
      { subModule: { sort: "asc", nulls: "first" } },
      { tcId: "asc" },
    ],
    select: caseSelect,
  });
  if (rows.length === 0) {
    throw badRequest(
      options.testCaseIds?.length
        ? "None of the selected test cases has an automation script."
        : "No test case in this project has an automation script yet.",
    );
  }

  const cases: ExportCase[] = rows.map((row) => ({
    tcId: row.tcId,
    title: row.title,
    platform: row.platform as "WEB" | "API",
    moduleName: row.module.name,
    subModule: row.subModule,
    code: row.script!.code,
  }));

  const folder = project.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  const zip = new JSZip();
  const files = projectFiles(project.name, cases, await pickEnvironment(projectId, options.environmentId));
  for (const [path, content] of Object.entries(files)) zip.file(`${folder}-tests/${path}`, content);

  return {
    fileName: `${folder}-tests.zip`,
    count: cases.length,
    content: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  };
}
