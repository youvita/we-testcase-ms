import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { toRole } from "@/lib/constants";
import { commentSchema } from "@/lib/validations";
import { createProject, createTestCase, createUser, resetDatabase } from "@/test/db";

import { askPoQuestion, replyToPoQuestion } from "./clarification.service";
import { postComment } from "./comment.service";
import { telegramRequirementsToVerify } from "./telegram.service";

const sent: { url: string; body: { chat_id: string; text: string; parse_mode: string } }[] = [];

beforeEach(async () => {
  await resetDatabase();
  sent.length = 0;
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_CHAT_ID", "-1001");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://qa.example.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response("{}", { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const as = (user: { id: string; role: string }) => ({ id: user.id, role: toRole(user.role) });
const messages = async (count: number) => {
  await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(count));
  return sent.map((m) => m.body.text);
};

describe("posting to the team's Telegram group", () => {
  it("posts a comment on a case, with a link to its discussion", async () => {
    const { project, module, owner: qa } = await createProject("WeBill365");
    const testCase = await createTestCase(project.id, module.id, "TC-1", "Check <button>");
    await postComment(testCase.id, as(qa), commentSchema.parse({ body: "Fails on build 12 & 13" }));

    const [text] = await messages(1);
    expect(sent[0]!.url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(sent[0]!.body).toMatchObject({ chat_id: "-1001", parse_mode: "HTML" });
    expect(text).toContain("commented");
    expect(text).toContain("<b>TC-1</b> Check &lt;button&gt;");
    expect(text).toContain("Fails on build 12 &amp; 13");
    expect(text).toContain(`https://qa.example.test/projects/${project.id}/test-cases/${testCase.id}#discussion`);
  });

  it("posts a question for the PO, and the PO's answer", async () => {
    const { project, owner: qa } = await createProject("WeBill365");
    const po = await createUser("ADMIN");
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
    expect(asked).toContain("asked");
    expect(asked).toContain("F1-03 Biller ID");
    expect(answered).toContain("answered");
    expect(answered).toContain("Not defined.");
  });

  it("posts requirements waiting for the PO to verify, and nothing when none wait", async () => {
    const { project, owner } = await createProject("WeBill365");
    const doc = await prisma.requirementDoc.create({
      data: { projectId: project.id, createdById: owner.id, title: "FRD", content: "x", charCount: 1 },
    });
    await prisma.requirement.createMany({
      data: ["F1", "F2"].map((code) => ({ projectId: project.id, docId: doc.id, code, title: code })),
    });
    telegramRequirementsToVerify(doc.id);
    const [text] = await messages(1);
    expect(text).toContain("2 requirements</b> to verify");

    await prisma.requirement.updateMany({ data: { verifiedAt: new Date() } });
    telegramRequirementsToVerify(doc.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent).toHaveLength(1);
  });

  it("sends nothing when Telegram is not set up", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const { project, module, owner } = await createProject();
    const testCase = await createTestCase(project.id, module.id, "TC-1");
    await postComment(testCase.id, as(owner), commentSchema.parse({ body: "Hi" }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sent).toHaveLength(0);
  });
});
