import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { toRole } from "@/lib/constants";
import { commentSchema } from "@/lib/validations";
import { createProject, createTestCase, createUser, resetDatabase } from "@/test/db";

import { askPoQuestion, replyToPoQuestion } from "./clarification.service";
import { postComment } from "./comment.service";
import { handleUpdate, telegramConnectLink, telegramStatus } from "./telegram-link.service";
import { telegramRequirementsToVerify } from "./telegram.service";

type Call = { url: string; body: Record<string, unknown> & { chat_id?: string; text?: string } };
const calls: Call[] = [];
let answer: (call: Call) => unknown = () => ({ ok: true, result: {} });

beforeEach(async () => {
  await resetDatabase();
  calls.length = 0;
  answer = () => ({ ok: true, result: {} });
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://qa.example.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = { url, body: JSON.parse(String(init.body)) };
    calls.push(call);
    return new Response(JSON.stringify(answer(call)), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const as = (user: { id: string; role: string }) => ({ id: user.id, role: toRole(user.role) });
const sent = () => calls.filter((call) => call.url.endsWith("/sendMessage"));
const messages = async (count: number) => {
  await vi.waitFor(() => expect(sent().length).toBeGreaterThanOrEqual(count));
  return sent();
};
const connect = (user: { id: string }, chatId: string, username?: string) =>
  prisma.user.update({ where: { id: user.id }, data: { telegramChatId: chatId, ...(username ? { username } : {}) } });

async function caseWithPo() {
  const { project, module, owner: qa } = await createProject("WeBill365");
  const po = await createUser("ADMIN");
  await prisma.project.update({ where: { id: project.id }, data: { productOwnerId: po.id } });
  const testCase = await createTestCase(project.id, module.id, "TC-1", "Check <button>");
  return { project, qa, po, testCase };
}

describe("Telegram, as private messages to the people an event is for", () => {
  it("sends a comment to the PO it notifies, with a link to its discussion", async () => {
    const { project, qa, po, testCase } = await caseWithPo();
    await connect(po, "501");
    await connect(qa, "502"); // the author: not told about their own comment
    await postComment(testCase.id, as(qa), commentSchema.parse({ body: "Fails on build 12 & 13" }));

    const [message] = await messages(1);
    expect(message!.url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(message!.body).toMatchObject({ chat_id: "501", parse_mode: "HTML" });
    expect(message!.body.text).toBe(
      [
        "📁 <b>WeBill365</b>",
        "Test case: <b>TC-1</b>",
        "Title: Check &lt;button&gt;",
        "",
        "<b>💬 Comment</b>",
        `<b>${qa.name}</b>: Fails on build 12 &amp; 13`,
        "",
        `🔗 <a href="https://qa.example.test/projects/${project.id}/test-cases/${testCase.id}#discussion">Open in WeTestCase</a>`,
      ].join("\n"),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent()).toHaveLength(1);
  });

  it("sends nothing to someone who has not connected Telegram", async () => {
    const { qa, testCase } = await caseWithPo();
    await postComment(testCase.id, as(qa), commentSchema.parse({ body: "Hi" }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent()).toHaveLength(0);
  });

  it("turns an @mention into a mention of the Telegram account they connected", async () => {
    const { project, qa, po, testCase } = await caseWithPo();
    const dev = await createUser("DEVELOPER");
    await prisma.project.update({ where: { id: project.id }, data: { members: { create: [{ userId: dev.id }] } } });
    await connect(dev, "777", "t_dev");
    await postComment(testCase.id, as(qa), commentSchema.parse({ body: "@t_dev please check" }));

    const [message] = await messages(1);
    expect(message!.body.chat_id).toBe("777");
    expect(message!.body.text).toContain(`<a href="tg://user?id=777">@${dev.name}</a> please check`);
    void po;
  });

  it("sends a question to the PO, and the answer back to the asker", async () => {
    const { project, qa, po } = await caseWithPo();
    await Promise.all([connect(po, "501"), connect(qa, "502")]);
    const doc = await prisma.requirementDoc.create({
      data: { projectId: project.id, createdById: qa.id, title: "FRD", content: "x", charCount: 1 },
    });
    const requirement = await prisma.requirement.create({
      data: { projectId: project.id, docId: doc.id, code: "F1-03", title: "Biller ID" },
    });
    const question = await askPoQuestion(project.id, qa, { requirementId: requirement.id, body: "Max length?", toUserId: po.id });
    await messages(1);
    await replyToPoQuestion(question.id, as(po), "Not defined.");

    const [asked, answered] = await messages(2);
    expect(asked!.body.chat_id).toBe("501");
    expect(asked!.body.text).toContain(`<b>❓ Question for the PO</b>\n<b>${qa.name}</b>: Max length?`);
    expect(answered!.body.chat_id).toBe("502");
    expect(answered!.body.text).toContain(`<b>✅ PO answer</b>\n<b>${po.name}</b>: Not defined.`);
  });

  it("tells the PO about requirements waiting to be verified, and nothing when none wait", async () => {
    const { project, qa, po } = await caseWithPo();
    await connect(po, "501");
    const doc = await prisma.requirementDoc.create({
      data: { projectId: project.id, createdById: qa.id, title: "FRD", content: "x", charCount: 1 },
    });
    await prisma.requirement.createMany({
      data: ["F1", "F2"].map((code) => ({ projectId: project.id, docId: doc.id, code, title: code })),
    });
    telegramRequirementsToVerify(doc.id);
    const [message] = await messages(1);
    expect(message!.body.chat_id).toBe("501");
    expect(message!.body.text).toContain("<b>📋 To verify</b>\n2 requirements waiting for you to verify");

    await prisma.requirement.updateMany({ data: { verifiedAt: new Date() } });
    telegramRequirementsToVerify(doc.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent()).toHaveLength(1);
  });

  it("drops the connection of someone who blocked the bot", async () => {
    const { qa, po, testCase } = await caseWithPo();
    await connect(po, "501");
    answer = () => ({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
    await postComment(testCase.id, as(qa), commentSchema.parse({ body: "Hi" }));
    await vi.waitFor(async () =>
      expect((await prisma.user.findUniqueOrThrow({ where: { id: po.id } })).telegramChatId).toBeNull(),
    );
  });

  it("sends nothing when Telegram is not set up", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const { qa, po, testCase } = await caseWithPo();
    await connect(po, "501");
    await postComment(testCase.id, as(qa), commentSchema.parse({ body: "Hi" }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toHaveLength(0);
  });
});

describe("connecting someone's own Telegram", () => {
  it("hands out a one-time link, and Start in Telegram connects it", async () => {
    const user = await createUser("QA");
    answer = (call) => (call.url.endsWith("/getMe") ? { ok: true, result: { username: "WeTestCaseBot" } } : { ok: true, result: [] });
    const { url } = await telegramConnectLink(user.id);
    const code = url.match(/^https:\/\/t\.me\/WeTestCaseBot\?start=([A-Za-z0-9]+)$/)![1]!;

    await handleUpdate({
      update_id: 1,
      message: { text: `/start ${code}`, chat: { id: 4242, type: "private" }, from: { id: 4242, username: "monika_kh", first_name: "Monika" } },
    });
    expect(await telegramStatus(user.id)).toEqual({ available: true, connected: true, account: "@monika_kh" });
    expect(sent().at(-1)!.body).toMatchObject({ chat_id: "4242" });
    expect(sent().at(-1)!.body.text).toContain("Connected to WeTestCase");

    // The code works once.
    await handleUpdate({ update_id: 2, message: { text: `/start ${code}`, chat: { id: 9, type: "private" } } });
    expect(sent().at(-1)!.body.text).toContain("expired or was already used");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).telegramChatId).toBe("4242");
  });
});
