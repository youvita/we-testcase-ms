import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { testCaseQuerySchema } from "@/lib/validations";
import { createProject, createTestCase, resetDatabase } from "@/test/db";

import { startRequirementReading, updateRequirement } from "./requirement.service";
import { listPendingDrafts } from "./test-case-draft.service";
import { confirmRequirementChanges, listTestCases, updateTestCase } from "./test-case.service";

beforeEach(resetDatabase);

async function seed() {
  const { project, module, owner } = await createProject();
  const doc = await prisma.requirementDoc.create({
    data: { projectId: project.id, createdById: owner.id, kind: "PRD", title: "Billing PRD", content: "x", charCount: 1 },
  });
  const requirement = await prisma.requirement.create({
    data: { projectId: project.id, docId: doc.id, code: "FR-1", title: "Create a bill", description: "As written." },
  });
  return { project, module, owner, doc, requirement };
}

const list = (projectId: string, query: Record<string, string> = {}) =>
  listTestCases(projectId, testCaseQuerySchema.parse(query)).then((page) => page.items);

/** A case made by accepting a draft written by a job of this kind. */
async function acceptedFrom(
  ctx: Awaited<ReturnType<typeof seed>>,
  tcId: string,
  kind: "GENERATE_TEST_CASES" | "EXPLORE_APP",
  requirementIds: string[],
) {
  const job = await prisma.aiJob.create({
    data: { projectId: ctx.project.id, kind, createdById: ctx.owner.id, input: { paths: ["/bills"] } },
  });
  const testCase = await createTestCase(ctx.project.id, ctx.module.id, tcId);
  await prisma.testCaseDraft.create({
    data: {
      projectId: ctx.project.id,
      moduleName: "Login",
      title: tcId,
      status: "ACCEPTED",
      requirementIds,
      jobId: job.id,
      testCaseId: testCase.id,
    },
  });
  return testCase;
}

describe("where a test case came from", () => {
  it("tells requirements, exploring and hand-written apart, and filters by it", async () => {
    const ctx = await seed();
    await acceptedFrom(ctx, "TC-1", "GENERATE_TEST_CASES", [ctx.requirement.id]);
    await acceptedFrom(ctx, "TC-2", "EXPLORE_APP", []);
    await createTestCase(ctx.project.id, ctx.module.id, "TC-3");

    expect((await list(ctx.project.id)).map((c) => [c.tcId, c.source])).toEqual([
      ["TC-1", "requirements"],
      ["TC-2", "explore"],
      ["TC-3", "manual"],
    ]);
    expect((await list(ctx.project.id, { source: "requirements" })).map((c) => c.tcId)).toEqual(["TC-1"]);
    expect((await list(ctx.project.id, { source: "explore" })).map((c) => c.tcId)).toEqual(["TC-2"]);
    expect((await list(ctx.project.id, { source: "manual" })).map((c) => c.tcId)).toEqual(["TC-3"]);
  });

  it("labels pending drafts with the run that wrote them", async () => {
    const ctx = await seed();
    const job = await prisma.aiJob.create({
      data: { projectId: ctx.project.id, kind: "EXPLORE_APP", createdById: ctx.owner.id, input: { paths: ["/bills", "/customers"] } },
    });
    await prisma.testCaseDraft.create({
      data: { projectId: ctx.project.id, moduleName: "Bills", title: "Explored", jobId: job.id, requirementIds: [] },
    });
    await prisma.testCaseDraft.create({
      data: { projectId: ctx.project.id, moduleName: "Bills", title: "Generated", requirementIds: [ctx.requirement.id] },
    });

    const drafts = await listPendingDrafts(ctx.project.id);
    expect(drafts.find((d) => d.title === "Explored")!.source).toMatchObject({
      kind: "explore",
      runId: job.id,
      detail: "/bills, /customers",
    });
    expect(drafts.find((d) => d.title === "Generated")!.source).toMatchObject({
      kind: "requirements",
      runId: null,
      detail: "Billing PRD",
    });
  });
});

describe("a requirement changing under its test cases", () => {
  async function linked() {
    const ctx = await seed();
    const testCase = await createTestCase(ctx.project.id, ctx.module.id, "TC-1");
    await prisma.testCaseRequirement.create({ data: { testCaseId: testCase.id, requirementId: ctx.requirement.id } });
    return { ...ctx, testCase };
  }
  const flagged = async (projectId: string) =>
    (await list(projectId, { requirementChanged: "yes" })).map((c) => c.tcId);

  it("flags the case when the text is edited, not when only its notes are", async () => {
    const ctx = await linked();
    await updateRequirement(ctx.requirement.id, {
      code: "FR-1",
      title: "Create a bill",
      description: "As written.",
      openQuestions: "- Who can do it?",
    });
    expect(await flagged(ctx.project.id)).toEqual([]);

    await updateRequirement(ctx.requirement.id, { code: "FR-1", title: "Create a bill", description: "With a due date." });
    expect(await flagged(ctx.project.id)).toEqual(["TC-1"]);
    expect((await list(ctx.project.id))[0]!.requirementChanged).toBe(true);
  });

  it("flags the case when a new document version changes the requirement", async () => {
    const ctx = await linked();
    await prisma.requirementDoc.update({ where: { id: ctx.doc.id }, data: { version: 2 } });
    const reading = await startRequirementReading(ctx.doc.id);
    await reading.save({ code: "FR-1", title: "Create a bill", description: "With a due date." }, 0);
    await reading.finish();
    expect(await flagged(ctx.project.id)).toEqual(["TC-1"]);
  });

  it("does not flag when a new version leaves the requirement as it was", async () => {
    const ctx = await linked();
    await prisma.requirementDoc.update({ where: { id: ctx.doc.id }, data: { version: 2 } });
    const reading = await startRequirementReading(ctx.doc.id);
    await reading.save({ code: "FR-1", title: "Create a bill", description: "As written." }, 0);
    await reading.finish();
    expect(await flagged(ctx.project.id)).toEqual([]);
  });

  it("clears when QA confirms the case still holds", async () => {
    const ctx = await linked();
    await updateRequirement(ctx.requirement.id, { code: "FR-1", title: "Create a bill", description: "Changed." });
    expect(await confirmRequirementChanges(ctx.testCase.id)).toEqual({ cleared: 1 });
    expect(await flagged(ctx.project.id)).toEqual([]);
  });

  it("clears when the case is edited", async () => {
    const ctx = await linked();
    await updateRequirement(ctx.requirement.id, { code: "FR-1", title: "Create a bill", description: "Changed." });
    await updateTestCase(ctx.testCase.id, {
      moduleId: ctx.module.id,
      tcId: "TC-1",
      title: "Create a bill with a due date",
      testType: "FUNCTIONAL",
      priority: "MEDIUM",
    });
    expect(await flagged(ctx.project.id)).toEqual([]);
  });
});
