import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, resetDatabase } from "@/test/db";

import { listJobs } from "./ai-job.service";

beforeEach(resetDatabase);

describe("listJobs targets", () => {
  it("says what each kind of job worked on", async () => {
    const { project, owner } = await createProject();
    const doc = await prisma.requirementDoc.create({
      data: { projectId: project.id, createdById: owner.id, title: "PRD", content: "x", charCount: 1 },
    });
    const base = { projectId: project.id, createdById: owner.id, status: "FAILED" as const };
    await prisma.aiJob.createMany({
      data: [
        { ...base, kind: "GENERATE_TEST_CASES", input: { requirementIds: ["r1", "r2"], depth: "essential" } },
        { ...base, kind: "EXTRACT_REQUIREMENTS", docId: doc.id, input: {} },
        { ...base, kind: "EXPLORE_APP", input: { environmentId: "env", paths: ["/login", "/home"] } },
        { ...base, kind: "WRITE_SCRIPT", input: { testCaseId: "tc" } },
      ],
    });

    const targets = Object.fromEntries(
      (await listJobs(project.id)).map((job) => [job.kind, job.targets]),
    );
    expect(targets).toEqual({
      GENERATE_TEST_CASES: ["r1", "r2"],
      EXTRACT_REQUIREMENTS: [doc.id],
      EXPLORE_APP: ["env:/login", "env:/home"],
      WRITE_SCRIPT: [],
    });
  });

  it("returns 10 by default and more when asked", async () => {
    const { project, owner } = await createProject();
    await prisma.aiJob.createMany({
      data: Array.from({ length: 12 }, () => ({
        projectId: project.id,
        createdById: owner.id,
        kind: "GENERATE_TEST_CASES" as const,
        status: "SUCCEEDED" as const,
        input: { requirementIds: [] },
      })),
    });
    expect(await listJobs(project.id)).toHaveLength(10);
    expect(await listJobs(project.id, { limit: 50 })).toHaveLength(12);
  });
});
