import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";
import { appUrl, escapeHtml, isTelegramConfigured, sendTelegram } from "@/lib/telegram";

/**
 * What the team's Telegram group hears about: questions for the PO and the
 * PO's answers, comments on test cases, and requirements waiting for the PO
 * to verify — all in one shape (see `notice`). Each is called once the change
 * is saved, without awaiting it (`void`): it loads what it needs, and a
 * failure is logged, never thrown.
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

async function send(build: () => Promise<string | null>) {
  if (!isTelegramConfigured()) return;
  try {
    const html = await build();
    if (html) await sendTelegram(html);
  } catch (error) {
    console.warn("[telegram] could not build a message:", error instanceof Error ? error.message : error);
  }
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
    return notice({
      project: question.project.name,
      about,
      kind: "question",
      who: question.asker.name,
      text: question.body,
      path,
    });
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
    return notice({
      project: question.project.name,
      about,
      kind: isAdmin(reply.author.role) ? "answer" : "followUp",
      who: reply.author.name,
      text: reply.body,
      path,
    });
  });
}

/** A comment, a reply, a question for the PO, or the PO's answer in a test case's discussion. */
export function telegramCommentPosted(commentId: string) {
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
    return notice({
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
    });
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
    return notice({
      project: doc.project.name,
      about: [["Document", `${doc.title} v${doc.version}`]],
      kind: "toVerify",
      text: `${waiting} requirement${waiting === 1 ? "" : "s"} waiting — PO, please review`,
      path: `/projects/${doc.projectId}/requirements?tab=requirements`,
    });
  });
}
