import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { toRole } from "@/lib/constants";
import { createProject, createTestCase, createUser, resetDatabase } from "@/test/db";

import {
  answerQuestion,
  askPoQuestion,
  listNotifications,
  listPoQuestions,
  markNotificationsRead,
  replyToPoQuestion,
  resolvePoQuestion,
  settleAnswer,
} from "./clarification.service";
import { answersToApply } from "@/utils/po-answers";

import { listComments } from "./comment.service";
import { reviewDrafts } from "./test-case-draft.service";

beforeEach(resetDatabase);

/** A user as the session hands it over. */
const as = (user: { id: string; role: string }) => ({ id: user.id, role: toRole(user.role) });

async function setUp() {
  const { project, module, owner: qa } = await createProject();
  const testCase = await createTestCase(project.id, module.id, "TC-POST-AUTH-TOKEN-01");
  const [po, otherAdmin] = [await createUser("ADMIN"), await createUser("ADMIN")];
  const retired = await createUser("ADMIN");
  await prisma.user.update({ where: { id: retired.id }, data: { isActive: false } });
  const doc = await prisma.requirementDoc.create({
    data: { projectId: project.id, createdById: qa.id, title: "API", content: "x", charCount: 1 },
  });
  const requirement = await prisma.requirement.create({
    data: { projectId: project.id, docId: doc.id, code: "POST /auth/token", title: "Token" },
  });
  const draft = await prisma.testCaseDraft.create({
    data: { projectId: project.id, moduleName: "Auth", title: "Token is issued", requirementIds: [requirement.id] },
  });
  return { project, qa, testCase, po, otherAdmin, retired, requirement, draft };
}

/** A question in a case's discussion, as accepting a draft leaves it. */
async function caseQuestion(testCaseId: string, askerId: string, body: string) {
  return prisma.comment.create({ data: { testCaseId, authorId: askerId, body, kind: "QUESTION" } });
}

describe("asking the PO", () => {
  it("notifies every active admin but the asker, and links them to the requirement", async () => {
    const { project, qa, po, otherAdmin, retired, requirement } = await setUp();
    await askPoQuestion(project.id, qa, { requirementId: requirement.id, body: "Token lifetime?" });

    for (const admin of [po, otherAdmin]) {
      const { unread, items } = await listNotifications(admin.id);
      expect(unread).toBe(1);
      expect(items[0]).toMatchObject({
        kind: "QUESTION_ASKED",
        actor: { id: qa.id },
        subject: "POST /auth/token",
        href: `/projects/${project.id}/requirements?tab=requirements&focus=${requirement.id}`,
        excerpt: "Token lifetime?",
      });
    }
    expect((await listNotifications(retired.id)).unread).toBe(0);
    expect((await listNotifications(qa.id)).unread).toBe(0);
  });

  it("asks one admin when named, and only an admin", async () => {
    const { project, qa, po, otherAdmin, requirement } = await setUp();
    await askPoQuestion(project.id, qa, { requirementId: requirement.id, body: "Limit?", toUserId: po.id });
    expect((await listNotifications(po.id)).unread).toBe(1);
    expect((await listNotifications(otherAdmin.id)).unread).toBe(0);
    expect((await listPoQuestions(project.id))[0]!.questionTo).toEqual({ id: po.id, name: po.name });

    await expect(
      askPoQuestion(project.id, qa, { requirementId: requirement.id, body: "?", toUserId: qa.id }),
    ).rejects.toThrow("Questions go to an admin");
  });

  it("refuses a requirement from another project, and a draft already reviewed", async () => {
    const { qa, requirement, draft } = await setUp();
    const { project: other } = await createProject("Other");
    await expect(askPoQuestion(other.id, qa, { requirementId: requirement.id, body: "?" })).rejects.toThrow("Requirement");
    await prisma.testCaseDraft.update({ where: { id: draft.id }, data: { status: "REJECTED" } });
    await expect(askPoQuestion(draft.projectId, qa, { draftId: draft.id, body: "?" })).rejects.toThrow("already been reviewed");
  });
});

describe("answering", () => {
  it("stores the answer, tells the asker, and clears only the answerer's notification", async () => {
    const { project, qa, po, otherAdmin, requirement } = await setUp();
    const question = await askPoQuestion(project.id, qa, { requirementId: requirement.id, body: "Token lifetime?" });
    expect(question.status).toBe("waiting");

    await replyToPoQuestion(question.id, as(po), "One day.");
    const [stored] = await listPoQuestions(project.id);
    expect(stored).toMatchObject({ status: "answered", requirementId: requirement.id });
    expect(stored!.replies).toMatchObject([{ body: "One day.", author: { id: po.id, isPo: true } }]);
    expect((await listNotifications(qa.id)).items[0]).toMatchObject({
      kind: "QUESTION_ANSWERED",
      subject: "POST /auth/token",
      excerpt: "One day.",
    });
    // The PO who answered acted on it; the other admin asked has not.
    expect((await listNotifications(po.id)).unread).toBe(0);
    expect((await listNotifications(otherAdmin.id)).unread).toBe(1);
  });

  it("answers a question in a case's discussion, and tells the asker", async () => {
    const { qa, testCase, po } = await setUp();
    const question = await caseQuestion(testCase.id, qa.id, "Limit?");

    await answerQuestion(question.id, as(po), "50 characters.");

    const [asked, answer] = await listComments(testCase.id);
    expect(asked!.answeredAt).not.toBeNull();
    expect(answer).toMatchObject({ kind: "ANSWER", answerToId: question.id, body: "50 characters." });
    expect((await listNotifications(qa.id)).items[0]).toMatchObject({
      kind: "QUESTION_ANSWERED",
      actor: { id: po.id },
      subject: "TC-POST-AUTH-TOKEN-01",
      href: `/projects/${testCase.projectId}/test-cases/${testCase.id}#discussion`,
      excerpt: "50 characters.",
    });
  });

  it("is for admins only, and only for questions", async () => {
    const { project, qa, testCase, po, requirement } = await setUp();
    const developer = await createUser("DEVELOPER");
    const asked = await askPoQuestion(project.id, qa, { requirementId: requirement.id, body: "?" });
    await expect(resolvePoQuestion(asked.id, as(developer), true)).rejects.toThrow("Only the person who asked");

    const question = await caseQuestion(testCase.id, qa.id, "Limit?");
    await expect(answerQuestion(question.id, as(developer), "No idea")).rejects.toThrow("Only an admin");
    const answer = await answerQuestion(question.id, as(po), "50.");
    await expect(answerQuestion(answer.id, as(po), "again")).rejects.toThrow("Question");
  });
});

describe("drafts", () => {
  it("move their questions into the new case's discussion when accepted", async () => {
    const { qa, po, project, draft } = await setUp();
    const question = await askPoQuestion(project.id, qa, { draftId: draft.id, body: "Which status code?" });
    expect((await listNotifications(po.id)).items[0]!.href).toBe(
      `/projects/${project.id}/requirements?tab=drafts&focus=${draft.id}`,
    );
    await replyToPoQuestion(question.id, as(po), "201.");
    await replyToPoQuestion(question.id, as(qa), "Also for a retry?");

    const { accepted } = await reviewDrafts(project.id, qa.id, { action: "accept", ids: [draft.id] });
    const caseId = accepted[0]!.testCaseId;
    const discussion = await listComments(caseId);
    expect(discussion.map((c) => [c.kind, c.body, c.authorId])).toEqual([
      ["QUESTION", "Which status code?", qa.id],
      ["ANSWER", "201.", po.id],
      ["COMMENT", "Also for a retry?", qa.id],
    ]);
    expect(discussion.slice(1).map((c) => c.answerToId)).toEqual([discussion[0]!.id, discussion[0]!.id]);
    // The draft's question no longer shows on the Requirements page; its
    // notifications now open the case.
    expect(await listPoQuestions(project.id)).toEqual([]);
    expect((await listNotifications(qa.id)).items[0]!.href).toBe(
      `/projects/${project.id}/test-cases/${caseId}#discussion`,
    );
  });

  it("drop their notifications when rejected", async () => {
    const { qa, po, project, draft } = await setUp();
    await askPoQuestion(project.id, qa, { draftId: draft.id, body: "?" });
    await reviewDrafts(project.id, qa.id, { action: "reject", ids: [draft.id] });
    expect(await listNotifications(po.id)).toEqual({ unread: 0, items: [] });
  });
});

describe("notifications", () => {
  it("are read one by one or all at once, only ever the reader's own", async () => {
    const { project, qa, po, requirement } = await setUp();
    await askPoQuestion(project.id, qa, { requirementId: requirement.id, body: "One?" });
    await askPoQuestion(project.id, qa, { requirementId: requirement.id, body: "Two?" });
    const { items } = await listNotifications(po.id);
    expect(items.map((n) => n.excerpt)).toEqual(["Two?", "One?"]);

    await markNotificationsRead(qa.id, [items[0]!.id]); // not qa's: no effect
    expect((await listNotifications(po.id)).unread).toBe(2);
    await markNotificationsRead(po.id, [items[0]!.id]);
    expect((await listNotifications(po.id)).unread).toBe(1);
    await markNotificationsRead(po.id);
    expect((await listNotifications(po.id)).unread).toBe(0);
  });

  it("leave out answers that were withdrawn", async () => {
    const { qa, testCase, po } = await setUp();
    const answer = await answerQuestion((await caseQuestion(testCase.id, qa.id, "Limit?")).id, as(po), "Oops");
    await prisma.comment.update({ where: { id: answer.id }, data: { deletedAt: new Date(), deletedById: po.id } });
    expect(await listNotifications(qa.id)).toEqual({ unread: 0, items: [] });
  });
});

describe("the conversation under a question", () => {
  it("goes back and forth, telling the other side each time, and its status follows", async () => {
    const { project, qa, po, otherAdmin, requirement } = await setUp();
    const question = await askPoQuestion(project.id, qa, { requirementId: requirement.id, body: "Token lifetime?" });
    await replyToPoQuestion(question.id, as(po), "One day.");
    await markNotificationsRead(qa.id);
    await markNotificationsRead(otherAdmin.id);

    // QA follows up: the admin who answered is told — not every admin again.
    const followed = await replyToPoQuestion(question.id, as(qa), "Counted from issue or from first use?");
    expect(followed.status).toBe("waiting");
    expect((await listNotifications(po.id)).items[0]).toMatchObject({
      kind: "QUESTION_REPLIED",
      actor: { id: qa.id },
      excerpt: "Counted from issue or from first use?",
    });
    expect((await listNotifications(otherAdmin.id)).unread).toBe(0);

    const answered = await replyToPoQuestion(question.id, as(po), "From issue.");
    expect(answered.status).toBe("answered");
    expect(answered.replies.map((r) => [r.body, r.author.isPo])).toEqual([
      ["One day.", true],
      ["Counted from issue or from first use?", false],
      ["From issue.", true],
    ]);
    expect((await listNotifications(qa.id)).items[0]).toMatchObject({ kind: "QUESTION_ANSWERED", excerpt: "From issue." });
    // Writing a reply marks the writer's own notifications about it read.
    expect((await listNotifications(po.id)).unread).toBe(0);
  });

  it("is resolved by the asker or an admin, and a new reply opens it again", async () => {
    const { project, qa, po, requirement } = await setUp();
    const question = await askPoQuestion(project.id, qa, { requirementId: requirement.id, body: "?" });
    const other = await createUser("QA");
    await expect(resolvePoQuestion(question.id, as(other), true)).rejects.toThrow("Only the person who asked");

    const resolved = await resolvePoQuestion(question.id, as(qa), true);
    expect(resolved).toMatchObject({ status: "resolved", resolvedBy: { id: qa.id } });
    // The PO had not answered yet; resolving does not clear their notification.
    expect((await listNotifications(po.id)).unread).toBe(1);

    const reopened = await replyToPoQuestion(question.id, as(po), "Still: one day.");
    expect(reopened).toMatchObject({ status: "answered", resolvedAt: null });
    expect((await resolvePoQuestion(question.id, as(po), true)).status).toBe("resolved");
    expect((await resolvePoQuestion(question.id, as(po), false)).status).toBe("answered");
  });

  it("asks every admin again when QA follows up before anyone answered", async () => {
    const { project, qa, po, otherAdmin, requirement } = await setUp();
    const question = await askPoQuestion(project.id, qa, { requirementId: requirement.id, body: "?" });
    await markNotificationsRead(po.id);
    await markNotificationsRead(otherAdmin.id);
    await replyToPoQuestion(question.id, as(qa), "Anyone?");
    expect((await listNotifications(po.id)).unread).toBe(1);
    expect((await listNotifications(otherAdmin.id)).unread).toBe(1);
  });
});

describe("putting a PO answer into the case", () => {
  it("asks once the PO answers, and updates the case's text", async () => {
    const { qa, testCase, po } = await setUp();
    const question = await caseQuestion(testCase.id, qa.id, "Error message?");
    expect(answersToApply(await listComments(testCase.id)).size).toBe(0);

    await answerQuestion(question.id, as(po), "'Invalid client id or client secret'.");
    expect([...answersToApply(await listComments(testCase.id)).keys()]).toEqual([question.id]);

    await settleAnswer(question.id, qa, {
      update: { expectedResult: "400, 'Invalid client id or client secret'.", openQuestions: undefined },
    });

    const updated = await prisma.testCase.findUniqueOrThrow({ where: { id: testCase.id } });
    expect(updated).toMatchObject({
      expectedResult: "400, 'Invalid client id or client secret'.",
      openQuestions: null,
    });
    const [asked] = await listComments(testCase.id);
    expect(asked).toMatchObject({ settledChangedCase: true, settledBy: { id: qa.id } });
    expect(answersToApply(await listComments(testCase.id)).size).toBe(0);
  });

  it("can need no change, and asks again when the PO answers again", async () => {
    const { qa, testCase, po } = await setUp();
    await prisma.testCase.update({ where: { id: testCase.id }, data: { expectedResult: "Kept" } });
    const question = await caseQuestion(testCase.id, qa.id, "Limit?");
    await answerQuestion(question.id, as(po), "As written.");

    await settleAnswer(question.id, qa, {});

    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: testCase.id } })).expectedResult).toBe("Kept");
    expect(answersToApply(await listComments(testCase.id)).size).toBe(0);

    await answerQuestion(question.id, as(po), "Actually, 50 characters.");
    expect(answersToApply(await listComments(testCase.id)).size).toBe(1);
  });

  it("waits for an answer, and leaves a case in the Trash alone", async () => {
    const { qa, testCase, po } = await setUp();
    const question = await caseQuestion(testCase.id, qa.id, "Limit?");
    await expect(settleAnswer(question.id, qa, {})).rejects.toThrow(/not answered/);

    await answerQuestion(question.id, as(po), "50.");
    await prisma.testCase.update({ where: { id: testCase.id }, data: { deletedAt: new Date() } });
    await expect(
      settleAnswer(question.id, qa, { update: { expectedResult: "50.", openQuestions: undefined } }),
    ).rejects.toThrow();
  });
});
