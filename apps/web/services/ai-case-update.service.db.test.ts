import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { toRole } from "@/lib/constants";
import type { SessionUser } from "@/lib/session";
import { createProject, createTestCase, createUser, resetDatabase } from "@/test/db";

import { getJob } from "./ai-job.service";
import { readSuggestion, startCaseUpdateSuggestion } from "./ai-case-update.service";
import { settleAnswer } from "./clarification.service";
import { updateCaseText } from "./test-case.service";

vi.mock("./claude-connection.service", () => ({
  requireClaudeToken: async () => "test-token",
}));

/** Every prompt sent; the reply moves the PO's answer into the expected result. */
const prompts: string[] = [];
vi.mock("@/lib/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claude")>()),
  askClaude: async ({ prompt }: { prompt: string }) => {
    prompts.push(prompt);
    return [
      "```json",
      JSON.stringify({
        preconditions: "Signed in.",
        steps: "1. Open Accounts.",
        expectedResult: "The list shows all linked accounts, not paginated.",
        openQuestions: "",
        summary: "Expected result now says the list is not paginated.",
        newCaseIdea: "Empty state when no account is linked.",
      }),
      "```",
    ].join("\n");
  },
}));

beforeEach(async () => {
  await resetDatabase();
  prompts.length = 0;
});

const asSession = (user: { id: string; name: string; email: string; role: string }) =>
  ({ id: user.id, name: user.name, email: user.email, role: toRole(user.role) }) as SessionUser;

async function setUp() {
  const { project, module, owner: qa } = await createProject();
  const po = await createUser("ADMIN");
  const testCase = await prisma.testCase.update({
    where: { id: (await createTestCase(project.id, module.id, "TC-1", "List accounts")).id },
    data: {
      preconditions: "Signed in.",
      steps: "1. Open Accounts.",
      expectedResult: "The list shows linked accounts.",
      openQuestions: "- Is the list paginated?",
    },
  });
  return { project, module, qa, po, testCase };
}

async function finished(jobId: string) {
  await vi.waitFor(
    async () => {
      const job = await getJob(jobId);
      expect(["SUCCEEDED", "FAILED"]).toContain(job.status);
    },
    { timeout: 5000 },
  );
  return getJob(jobId);
}

describe("suggesting a case update from a PO answer", () => {
  it("drafts the update from a question in the case's discussion", async () => {
    const { qa, po, testCase } = await setUp();
    const question = await prisma.comment.create({
      data: { testCaseId: testCase.id, authorId: qa.id, body: "Is the list paginated?", kind: "QUESTION" },
    });
    await expect(
      startCaseUpdateSuggestion(testCase.id, { source: { kind: "comment", questionId: question.id } }, asSession(qa)),
    ).rejects.toThrow(/not answered/);

    await prisma.comment.create({
      data: { testCaseId: testCase.id, authorId: po.id, body: "No, show them all.", kind: "ANSWER", answerToId: question.id },
    });
    await prisma.comment.update({ where: { id: question.id }, data: { answeredAt: new Date() } });
    const job = await startCaseUpdateSuggestion(
      testCase.id,
      { source: { kind: "comment", questionId: question.id } },
      asSession(qa),
    );
    const done = await finished(job.id);
    expect(done.status).toBe("SUCCEEDED");
    expect(done.result).toMatchObject({
      expectedResult: "The list shows all linked accounts, not paginated.",
      openQuestions: "",
      newCaseIdea: "Empty state when no account is linked.",
    });
    // The AI saw the case and the PO's answer.
    expect(prompts[0]).toContain("The list shows linked accounts.");
    expect(prompts[0]).toContain("PO (");
    expect(prompts[0]).toContain("No, show them all.");

    // Nothing is saved until QA applies it.
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: testCase.id } })).expectedResult).toBe(
      "The list shows linked accounts.",
    );
    await settleAnswer(question.id, qa, { update: { ...(done.result as object), openQuestions: undefined } });
    const saved = await prisma.testCase.findUniqueOrThrow({ where: { id: testCase.id } });
    expect(saved).toMatchObject({
      expectedResult: "The list shows all linked accounts, not paginated.",
      openQuestions: null,
      steps: "1. Open Accounts.",
    });
  });

  it("drafts the update from a question on a requirement the case verifies, not another", async () => {
    const { project, qa, po, testCase } = await setUp();
    const doc = await prisma.requirementDoc.create({
      data: { projectId: project.id, createdById: qa.id, title: "PRD", content: "x", charCount: 1 },
    });
    const [linked, other] = await Promise.all(
      ["F1-01", "F1-02"].map((code) =>
        prisma.requirement.create({
          data: { projectId: project.id, docId: doc.id, code, title: code, description: `${code} text` },
        }),
      ),
    );
    await prisma.testCaseRequirement.create({
      data: { testCaseId: testCase.id, requirementId: linked!.id, requirementChangedAt: new Date() },
    });
    const ask = (requirementId: string) =>
      prisma.poQuestion.create({
        data: {
          projectId: project.id,
          requirementId,
          askerId: qa.id,
          body: "Paginated?",
          answeredAt: new Date(),
          replies: { create: [{ authorId: po.id, body: "No." }] },
        },
      });

    const elsewhere = await ask(other!.id);
    await expect(
      startCaseUpdateSuggestion(testCase.id, { source: { kind: "requirement", questionId: elsewhere.id } }, asSession(qa)),
    ).rejects.toThrow(/Question/);

    const question = await ask(linked!.id);
    const job = await startCaseUpdateSuggestion(
      testCase.id,
      { source: { kind: "requirement", questionId: question.id } },
      asSession(qa),
    );
    expect((await finished(job.id)).status).toBe("SUCCEEDED");
    expect(prompts[0]).toContain("F1-01 text");

    // Applying it updates the case, and it no longer waits on the changed requirement.
    await updateCaseText(testCase.id, { expectedResult: "Not paginated.", steps: "1. Open Accounts." });
    expect(
      await prisma.testCaseRequirement.count({ where: { testCaseId: testCase.id, requirementChangedAt: { not: null } } }),
    ).toBe(0);
  });

  it("refuses an answer it cannot read", () => {
    expect(() => readSuggestion("I think the list is fine.")).toThrow(/readable/);
    expect(readSuggestion('```json\n{"expectedResult": " Done. ", "newCaseIdea": ""}\n```')).toEqual({
      preconditions: "",
      steps: "",
      expectedResult: "Done.",
      openQuestions: "",
      summary: "",
      newCaseIdea: null,
    });
  });
});
