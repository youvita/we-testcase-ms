import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, createTestCase, resetDatabase } from "@/test/db";

import { settleAnswer } from "./clarification.service";
import { reviewDrafts } from "./test-case-draft.service";
import { updateCaseText, updateTestCase } from "./test-case.service";

beforeEach(resetDatabase);

async function setUp() {
  const { project, module, owner } = await createProject();
  const doc = await prisma.requirementDoc.create({
    data: { projectId: project.id, createdById: owner.id, title: "FRD", content: "x", charCount: 1 },
  });
  const requirement = await prisma.requirement.create({
    data: {
      projectId: project.id,
      docId: doc.id,
      code: "F1-01",
      title: "List accounts",
      openQuestions: "- Is the list paginated or sortable?\n- What is shown when no account is linked?",
      verifiedAt: new Date(),
    },
  });
  const linked = await createTestCase(project.id, module.id, "TC-1");
  await prisma.testCaseRequirement.create({ data: { testCaseId: linked.id, requirementId: requirement.id } });
  const unlinked = await createTestCase(project.id, module.id, "TC-2");
  return { project, module, owner, requirement, linked, unlinked };
}

const questionsOf = async (requirementId: string) =>
  (await prisma.requirement.findUniqueOrThrow({ where: { id: requirementId } })).openQuestions;
const caseQuestionsOf = async (testCaseId: string) =>
  (await prisma.testCase.findUniqueOrThrow({ where: { id: testCaseId } })).openQuestions;

const edit = (testCaseId: string, moduleId: string, tcId: string, openQuestions: string) =>
  updateTestCase(testCaseId, { moduleId, tcId, title: tcId, testType: "FUNCTIONAL", priority: "MEDIUM", openQuestions });

describe("a test case's open questions, kept in one place", () => {
  it("saves a verifying case's questions on its requirement, not on the case", async () => {
    const { module, requirement, linked } = await setUp();
    // QA settles one question and adds another, from the case's edit form.
    await edit(linked.id, module.id, "TC-1", "- What is shown when no account is linked?\n- Which columns are sortable?");
    expect(await questionsOf(requirement.id)).toBe(
      "- What is shown when no account is linked?\n- Which columns are sortable?",
    );
    expect(await caseQuestionsOf(linked.id)).toBeNull();
  });

  it("keeps a case's own questions when it verifies no requirement", async () => {
    const { module, unlinked } = await setUp();
    await edit(unlinked.id, module.id, "TC-2", "- Which browsers?");
    expect(await caseQuestionsOf(unlinked.id)).toBe("- Which browsers?");
  });

  it("takes a settled question off the requirement when a PO answer is put into the case", async () => {
    const { requirement, linked, owner } = await setUp();
    const question = await prisma.comment.create({
      data: { testCaseId: linked.id, authorId: owner.id, body: "Paginated?", kind: "QUESTION", answeredAt: new Date() },
    });
    await settleAnswer(question.id, owner, {
      update: { expectedResult: "All accounts, not paginated.", openQuestions: "- What is shown when no account is linked?" },
    });
    expect(await questionsOf(requirement.id)).toBe("- What is shown when no account is linked?");

    await updateCaseText(linked.id, { expectedResult: "All accounts." });
    expect(await questionsOf(requirement.id)).toBeNull();
  });

  it("adds an accepted draft's new questions to its requirement", async () => {
    const { project, owner, requirement } = await setUp();
    const draft = await prisma.testCaseDraft.create({
      data: {
        projectId: project.id,
        moduleName: "Login",
        title: "Empty state",
        requirementIds: [requirement.id],
        openQuestions: "- what is shown when no account is linked\n- Is there a call to action?",
      },
    });
    const result = await reviewDrafts(project.id, owner.id, { action: "accept", ids: [draft.id] });
    const testCaseId = result.accepted[0]!.testCaseId;

    expect(await questionsOf(requirement.id)).toBe(
      "- Is the list paginated or sortable?\n- What is shown when no account is linked?\n- Is there a call to action?",
    );
    expect(await caseQuestionsOf(testCaseId)).toBeNull();
  });
});
