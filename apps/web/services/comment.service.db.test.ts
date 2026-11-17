import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { toRole } from "@/lib/constants";
import { commentSchema } from "@/lib/validations";
import { createProject, createTestCase, createUser, resetDatabase } from "@/test/db";

import { editComment, listComments, postComment } from "./comment.service";

beforeEach(resetDatabase);

const as = (user: { id: string; role: string }) => ({ id: user.id, role: toRole(user.role) });
const post = (testCaseId: string, user: { id: string; role: string }, input: Record<string, unknown>) =>
  postComment(testCaseId, as(user), commentSchema.parse(input));

async function setUp() {
  const { project, module, owner: qa } = await createProject();
  const [dev, po, otherPo] = [await createUser("DEVELOPER"), await createUser("ADMIN"), await createUser("ADMIN")];
  // po owns the project; QA works on it as one of the people in charge.
  await prisma.project.update({
    where: { id: project.id },
    data: { productOwnerId: po.id, members: { create: [{ userId: qa.id }] } },
  });
  const testCase = await createTestCase(project.id, module.id, "TC-1");
  return { project, module, testCase, qa, dev, po, otherPo };
}

const notified = async (kind: "COMMENT_POSTED" | "COMMENT_REPLIED" | "QUESTION_ANSWERED" | "QUESTION_ASKED") =>
  (await prisma.notification.findMany({ where: { kind }, select: { recipientId: true } }))
    .map((n) => n.recipientId)
    .sort();

describe("posting to a case's discussion", () => {
  it("sends a new comment to the project's product owner", async () => {
    const { project, testCase, qa, po, otherPo } = await setUp();
    await post(testCase.id, qa, { body: "What is the max length?" });
    expect(await notified("COMMENT_POSTED")).toEqual([po.id]);

    // A project without one yet: every admin.
    await prisma.notification.deleteMany();
    await prisma.project.update({ where: { id: project.id }, data: { productOwnerId: null } });
    await post(testCase.id, qa, { body: "Anyone?" });
    expect(await notified("COMMENT_POSTED")).toEqual([po.id, otherPo.id].sort());
  });

  it("sends the PO's comment to the people in charge while nobody has worked on the case", async () => {
    const { testCase, qa, po } = await setUp();
    await post(testCase.id, po, { body: "Please check the new rule." });
    expect(await notified("COMMENT_POSTED")).toEqual([qa.id]);
  });

  it("sends the PO's comment to whoever last ran the case and everyone who posted", async () => {
    const { testCase, qa, dev, po } = await setUp();
    const tester = await createUser("QA");
    await prisma.testExecution.create({ data: { testCaseId: testCase.id, testerId: tester.id, status: "FAILED" } });
    await post(testCase.id, dev, { body: "Fixed in 13." });
    await prisma.notification.deleteMany();

    await post(testCase.id, po, { body: "Please retest on build 13." });
    // Not everyone in charge: QA has not run or discussed this case.
    expect(await notified("COMMENT_POSTED")).toEqual([tester.id, dev.id].sort());
    expect(await notified("COMMENT_POSTED")).not.toContain(qa.id);
  });

  it("threads replies under the first comment and tells the thread", async () => {
    const { testCase, qa, dev, po } = await setUp();
    const root = await post(testCase.id, qa, { body: "Still failing on build 12." });
    const first = await post(testCase.id, po, { body: "Dev, can you check?", replyToId: root.id });
    // Replying to a reply lands under the same comment.
    const second = await post(testCase.id, dev, { body: "Fixed in 13.", replyToId: first.id });
    expect([first.answerToId, second.answerToId]).toEqual([root.id, root.id]);

    // The PO's reply told QA; the developer's told QA and the PO.
    expect(await notified("COMMENT_REPLIED")).toEqual([qa.id, qa.id, po.id].sort());
    expect((await listComments(testCase.id)).map((c) => c.body)).toEqual([
      "Still failing on build 12.",
      "Dev, can you check?",
      "Fixed in 13.",
    ]);
  });

  it("makes the PO's reply to a question its answer", async () => {
    const { testCase, qa, po } = await setUp();
    const question = await prisma.comment.create({
      data: { testCaseId: testCase.id, authorId: qa.id, body: "Max length?", kind: "QUESTION" },
    });
    const answer = await post(testCase.id, po, { body: "50 characters.", replyToId: question.id });
    expect(answer).toMatchObject({ kind: "ANSWER", answerToId: question.id });
    expect(await notified("QUESTION_ANSWERED")).toEqual([qa.id]);
  });

  it("refuses a reply to a comment on another case", async () => {
    const { project, module, testCase, qa } = await setUp();
    const other = await createTestCase(project.id, module.id, "TC-2");
    const root = await post(other.id, qa, { body: "Elsewhere" });
    await expect(post(testCase.id, qa, { body: "Hi", replyToId: root.id })).rejects.toThrow(/Comment/);
  });
});

describe("asking the PO on a case", () => {
  it("posts a question the PO's reply answers", async () => {
    const { testCase, qa, po } = await setUp();
    const question = await post(testCase.id, qa, { body: "Could you clarify:\n- Max length?", question: true });
    expect(question.kind).toBe("QUESTION");
    expect(await notified("QUESTION_ASKED")).toEqual([po.id]);

    const answer = await post(testCase.id, po, { body: "50 characters.", replyToId: question.id });
    expect(answer.kind).toBe("ANSWER");
    const asked = await prisma.comment.findUniqueOrThrow({ where: { id: question.id } });
    expect(asked.answeredAt).not.toBeNull();
  });

  it("keeps an admin's post a comment: the PO answers, not asks", async () => {
    const { testCase, po } = await setUp();
    const comment = await post(testCase.id, po, { body: "Note", question: true });
    expect(comment.kind).toBe("COMMENT");
  });
});

describe("@mentions", () => {
  const named = (user: { id: string }, username: string) =>
    prisma.user.update({ where: { id: user.id }, data: { username } });
  const mentioned = async () =>
    (await prisma.notification.findMany({ where: { kind: "COMMENT_MENTIONED" }, select: { recipientId: true } }))
      .map((n) => n.recipientId)
      .sort();

  it("tells the people mentioned who can open the project, once", async () => {
    const { testCase, qa, dev, po } = await setUp();
    const outsider = await createUser("DEVELOPER");
    await Promise.all([named(qa, "t_quinn"), named(dev, "t_dev"), named(po, "t_monika"), named(outsider, "t_outsider")]);

    await post(testCase.id, qa, { body: "@T_Monika @t_dev please check (cc @t_outsider, @t_quinn, mail me@test.com)" });
    // The developer is not on the project and cannot read it; QA wrote it.
    expect(await mentioned()).toEqual([po.id]);
    // "Mentioned you" replaces the PO's plain "commented on".
    expect(await notified("COMMENT_POSTED")).toEqual([]);
  });

  it("tells only the people newly mentioned when a post is edited", async () => {
    const { testCase, qa, dev, po } = await setUp();
    await prisma.project.update({ where: { id: testCase.projectId }, data: { members: { create: [{ userId: dev.id }] } } });
    await Promise.all([named(dev, "t_dev"), named(po, "t_monika")]);

    const comment = await post(testCase.id, qa, { body: "@t_monika please check" });
    await editComment(comment.id, qa, { body: "@t_monika @t_dev please check" });
    expect(await mentioned()).toEqual([dev.id, po.id].sort());
  });
});
