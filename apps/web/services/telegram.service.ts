import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";
import { appUrl, escapeHtml, isTelegramConfigured, sendTelegramTo } from "@/lib/telegram";
import { mentionedUsernames } from "@/utils/mentions";

import { dropTelegram } from "./telegram-link.service";

/**
 * Telegram, as private messages from the bot: each event goes to the people
 * it is for — the same people its in-app notification goes to — who have
 * connected their Telegram (Your account → Connect Telegram). Nothing goes to
 * a group. Questions for the PO and the PO's answers, comments on test cases,
 * and requirements waiting for the PO to verify, all in one shape (see
 * `notice`). Each is called once the change is saved, without awaiting it
 * (`void`): it loads what it needs, and a failure is logged, never thrown.
 */

const EXCERPT = 300;

function excerpt(body: string): string {
  const text = body.trim();
  return escapeHtml(text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text);
}

/** What happened, as the heading of a message's middle part. */
const KIND = {
  comment: "💬 Comment",
  reply: "↩️ Reply",
  question: "❓ Question for the PO",
  answer: "✅ PO answer",
  followUp: "↩️ Follow-up",
  toVerify: "📋 To verify",
  reminder: "🔔 Reminder to verify",
} as const;

/**
 * Every message has one shape, whatever happened:
 *
 *   📁 WeBill365
 *   Test case: TC-AI-03
 *   Title: Create a customer with only the mandatory fields
 *
 *   ❓ Question for the PO
 *   Alice Admin: Please clarify …
 *
 *   📎 1 file attached
 *   🔗 Open in WeTestCase
 */
function notice({
  project,
  about,
  kind,
  who,
  text,
  files = 0,
  path,
}: {
  project: string;
  /** What it is about, as label → value lines; the first value in bold. */
  about: [label: string, value: string][];
  kind: keyof typeof KIND;
  who?: string;
  text: string;
  files?: number;
  path: string;
}) {
  const url = appUrl(path);
  const said = text.trim() ? excerpt(text) : "";
  const sections = [
    [
      `📁 <b>${escapeHtml(project)}</b>`,
      ...about.map(([label, value], index) =>
        index === 0 ? `${label}: <b>${escapeHtml(value)}</b>` : `${label}: ${escapeHtml(value)}`,
      ),
    ],
    [`<b>${KIND[kind]}</b>`, who ? `<b>${escapeHtml(who)}</b>${said ? `: ${said}` : ""}` : said],
    [
      files > 0 && `📎 ${files} file${files === 1 ? "" : "s"} attached`,
      url && `🔗 <a href="${escapeHtml(url)}">Open in WeTestCase</a>`,
    ],
  ];
  return sections
    .map((lines) => lines.filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}

/**
 * @mentions as Telegram mentions: "@monika" — the app's username — becomes a
 * mention of the Telegram account Monika connected, whatever it is called
 * there. Someone not connected stays as written.
 */
export async function withTelegramMentions(html: string): Promise<string> {
  const names = mentionedUsernames(html);
  if (names.length === 0) return html;
  const people = await prisma.user.findMany({
    where: { username: { in: names }, telegramChatId: { not: null } },
    select: { username: true, name: true, telegramChatId: true },
  });
  const byName = new Map(people.map((person) => [person.username!, person]));
  return html.replace(/(?<![\w.@/])@([a-zA-Z0-9_.]*[a-zA-Z0-9_])/g, (whole, name: string) => {
    const person = byName.get(name.toLowerCase());
    return person ? `<a href="tg://user?id=${person.telegramChatId}">@${escapeHtml(person.name)}</a>` : whole;
  });
}

/** A message, and the people it is for (user ids). */
type Outgoing = { html: string; to: string[] };

async function send(build: () => Promise<Outgoing | null>) {
  if (!isTelegramConfigured()) return;
  try {
    const message = await build();
    if (!message || message.to.length === 0) return;
    const people = await prisma.user.findMany({
      where: { id: { in: [...new Set(message.to)] }, isActive: true, telegramChatId: { not: null } },
      select: { telegramChatId: true },
    });
    if (people.length === 0) return;
    const html = await withTelegramMentions(message.html);
    for (const person of people) {
      const chatId = person.telegramChatId!;
      // Blocked the bot or deleted the chat: it cannot reach them any more.
      if ((await sendTelegramTo(chatId, html)) === "blocked") await dropTelegram(chatId);
    }
  } catch (error) {
    console.warn("[telegram] could not send a message:", error instanceof Error ? error.message : error);
  }
}

/** Who an event's in-app notifications went to. */
async function notified(where: Prisma.NotificationWhereInput): Promise<string[]> {
  const rows = await prisma.notification.findMany({ where, select: { recipientId: true } });
  return rows.map((row) => row.recipientId);
}

/** A project's PO, or every active admin while it has none. */
async function productOwners(projectId: string): Promise<string[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { productOwner: { select: { id: true, isActive: true } } },
  });
  if (project?.productOwner?.isActive) return [project.productOwner.id];
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  return admins.map((admin) => admin.id);
}

/** What a question on a requirement or draft is about, and where it opens. */
async function questionSubject(questionId: string) {
  const question = await prisma.poQuestion.findUnique({
    where: { id: questionId },
    select: {
      body: true,
      projectId: true,
      project: { select: { name: true } },
      asker: { select: { name: true } },
      requirement: { select: { id: true, code: true, title: true } },
      draft: { select: { id: true, title: true } },
    },
  });
  if (!question) return null;
  const requirements = `/projects/${question.projectId}/requirements`;
  const about: [string, string][] = question.requirement
    ? [
        ["Requirement", question.requirement.code],
        ["Title", question.requirement.title],
      ]
    : [["Draft test case", question.draft?.title ?? ""]];
  const path = question.requirement
    ? `${requirements}?tab=requirements&focus=${question.requirement.id}`
    : `${requirements}?tab=drafts&focus=${question.draft?.id ?? ""}`;
  return { question, about, path };
}

/** QA asked the PO about a requirement or a review draft. */
export function telegramQuestionAsked(questionId: string) {
  void send(async () => {
    const found = await questionSubject(questionId);
    if (!found) return null;
    const { question, about, path } = found;
    return {
      to: await notified({ questionId, replyId: null }),
      html: notice({
        project: question.project.name,
        about,
        kind: "question",
        who: question.asker.name,
        text: question.body,
        path,
      }),
    };
  });
}

/** Someone replied under a question on a requirement or draft: the PO's answer, or QA's follow-up. */
export function telegramQuestionReplied(questionId: string, replyId: string) {
  void send(async () => {
    const [found, reply] = await Promise.all([
      questionSubject(questionId),
      prisma.poQuestionReply.findUnique({
        where: { id: replyId },
        select: { body: true, author: { select: { name: true, role: true } } },
      }),
    ]);
    if (!found || !reply) return null;
    const { question, about, path } = found;
    return {
      to: await notified({ replyId }),
      html: notice({
        project: question.project.name,
        about,
        kind: isAdmin(reply.author.role) ? "answer" : "followUp",
        who: reply.author.name,
        text: reply.body,
        path,
      }),
    };
  });
}

/**
 * A comment, a reply, a question for the PO, or the PO's answer in a test
 * case's discussion — to whoever it notified. Called after @mentions are
 * notified too. `since`: only those notified from then on (an edit that
 * mentions someone new).
 */
export function telegramCommentPosted(commentId: string, since?: Date) {
  void send(async () => {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        body: true,
        kind: true,
        answerToId: true,
        _count: { select: { attachments: true } },
        author: { select: { name: true } },
        testCase: {
          select: { id: true, tcId: true, title: true, projectId: true, project: { select: { name: true } } },
        },
      },
    });
    if (!comment) return null;
    const { testCase } = comment;
    return {
      to: await notified({ commentId, ...(since ? { createdAt: { gte: since } } : {}) }),
      html: notice({
      project: testCase.project.name,
      about: [
        ["Test case", testCase.tcId],
        ["Title", testCase.title],
      ],
      kind:
        comment.kind === "ANSWER"
          ? "answer"
          : comment.kind === "QUESTION"
            ? "question"
            : comment.answerToId
              ? "reply"
              : "comment",
      who: comment.author.name,
      text: comment.body,
      files: comment._count.attachments,
      path: `/projects/${testCase.projectId}/test-cases/${testCase.id}#discussion`,
      }),
    };
  });
}

/** A document was read: its requirements still waiting for the PO to verify. */
export function telegramRequirementsToVerify(docId: string) {
  void send(async () => {
    const doc = await prisma.requirementDoc.findUnique({
      where: { id: docId },
      select: {
        title: true,
        version: true,
        projectId: true,
        project: { select: { name: true } },
        _count: { select: { requirements: { where: { status: "ACTIVE", verifiedAt: null } } } },
      },
    });
    const waiting = doc?._count.requirements ?? 0;
    if (!doc || waiting === 0) return null;
    return {
      to: await productOwners(doc.projectId),
      html: notice({
        project: doc.project.name,
        about: [["Document", `${doc.title} v${doc.version}`]],
        kind: "toVerify",
        text: `${waiting} requirement${waiting === 1 ? "" : "s"} waiting for you to verify`,
        path: `/projects/${doc.projectId}/requirements?tab=requirements&coverage=unverified`,
      }),
    };
  });
}

/** QA reminded the PO — and anyone they @mentioned — that requirements are waiting to be verified. */
export function telegramVerifyReminder(
  projectId: string,
  who: string,
  waiting: number,
  note: string | null,
  to: string[],
) {
  void send(async () => {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    if (!project) return null;
    return {
      to,
      html: notice({
        project: project.name,
        about: [["Requirements", `${waiting} waiting to be verified`]],
        kind: "reminder",
        who,
        text: note ?? "Please review and verify them.",
        path: `/projects/${projectId}/requirements?tab=requirements&coverage=unverified`,
      }),
    };
  });
}
