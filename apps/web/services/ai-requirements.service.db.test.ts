import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, resetDatabase } from "@/test/db";

import { resumeJobs } from "./ai-job.service";
import "./ai-requirements.service";

vi.mock("./claude-connection.service", () => ({
  requireClaudeToken: async () => "test-token",
}));

/** Every prompt sent, and a reply drafting one case per requirement in it. */
const prompts: string[] = [];
vi.mock("@/lib/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claude")>()),
  askClaude: async ({ prompt }: { prompt: string }) => {
    prompts.push(prompt);
    const codes = [...prompt.matchAll(/\b(REQ-\d+)\b/g)].map((m) => m[1]);
    const testCases = [...new Set(codes)].map((code) => ({
      requirementCodes: [code],
      module: "Login",
      title: `Check ${code}`,
      steps: ["Do it"],
      expectedResult: "It works",
    }));
    return JSON.stringify({ testCases });
  },
}));

beforeEach(async () => {
  await resetDatabase();
  prompts.length = 0;
});

describe("drafting test cases after a restart", () => {
  it("carries on after the last batch it saved", async () => {
    const { project, owner } = await createProject();
    const doc = await prisma.requirementDoc.create({
      data: { projectId: project.id, createdById: owner.id, title: "PRD", content: "x", charCount: 1 },
    });
    // Two batches at "thorough" depth (three requirements each).
    const requirements: { id: string }[] = [];
    for (let n = 1; n <= 6; n += 1) {
      requirements.push(
        await prisma.requirement.create({
          data: { docId: doc.id, projectId: project.id, code: `REQ-${n}`, title: `Requirement ${n}`, position: n },
        }),
      );
    }
    // Interrupted after saving the first batch's drafts.
    const job = await prisma.aiJob.create({
      data: {
        projectId: project.id,
        createdById: owner.id,
        kind: "GENERATE_TEST_CASES",
        status: "RUNNING",
        attempts: 1,
        progressDone: 1,
        progressTotal: 2,
        input: { requirementIds: requirements.map((r) => r.id), platform: "WEB", depth: "thorough" },
      },
    });
    await prisma.testCaseDraft.createMany({
      data: [1, 2, 3].map((n) => ({
        projectId: project.id,
        jobId: job.id,
        moduleName: "Login",
        title: `Check REQ-${n}`,
        platform: "WEB" as const,
        requirementIds: [requirements[n - 1]!.id],
      })),
    });

    (globalThis as { __aiJobs?: { resumed?: Promise<void> } }).__aiJobs!.resumed = undefined;
    await resumeJobs();
    await vi.waitFor(
      async () => {
        const row = await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } });
        if (row.status === "RUNNING" || row.status === "QUEUED") throw new Error("still going");
      },
      { timeout: 5_000, interval: 20 },
    );

    const after = await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toMatchObject({ status: "SUCCEEDED", progressDone: 2, attempts: 2 });
    // Only the second batch went to the AI, and nothing was drafted twice.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("REQ-4");
    expect(prompts[0]).not.toContain("REQ-1");
    const titles = (await prisma.testCaseDraft.findMany({ where: { jobId: job.id } })).map((d) => d.title);
    expect(titles.sort()).toEqual(["Check REQ-1", "Check REQ-2", "Check REQ-3", "Check REQ-4", "Check REQ-5", "Check REQ-6"]);
    expect(after.summary).toMatch(/^Drafted 6 test cases/);
  });
});
