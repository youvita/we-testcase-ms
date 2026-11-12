import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/permissions";
import { appUrl, escapeHtml, isTelegramConfigured, sendTelegram } from "@/lib/telegram";

/**
 * What the team's Telegram group hears about: questions for the PO and the
 * PO's answers, comments on test cases, and requirements waiting for the PO
 * to verify. Each is called once the change is saved, without awaiting it
 * (`void`): it loads what it needs, and a failure is logged, never thrown.
 */

const EXCERPT = 300;

function excerpt(body: string): string {
  const text = body.trim();
  return escapeHtml(text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text);
}

function message(lines: (string | null | false | undefined)[], path: string) {
  const url = appUrl(path);
  return [...lines.filter(Boolean), url ? `<a href="${escapeHtml(url)}">Open in WeTestCase</a>` : null]
    .filter(Boolean)
    .join("\n");
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
      questionTo: { select: { name: true } },
      requirement: { select: { id: true, code: true, title: true } },
      draft: { select: { id: true, title: true } },
    },
  });
  if (!question) return null;
  const requirements = `/projects/${question.projectId}/requirements`;
  const subject = question.requirement
    ? `${question.requirement.code} ${question.requirement.title}`
    : `draft “${question.draft?.title ?? ""}”`;
  const path = question.requirement
    ? `${requirements}?tab=requirements&focus=${question.requirement.id}`
    : `${requirements}?tab=drafts&focus=${question.draft?.id ?? ""}`;
  return { question, subject, path };
}

/** QA asked the PO about a requirement or a review draft. */
export function telegramQuestionAsked(questionId: string) {
  void send(async () => {
    const found = await questionSubject(questionId);
    if (!found) return null;
    const { question, subject, path } = found;
    return message(
      [
        `❓ <b>${escapeHtml(question.asker.name)}</b> asked <b>${escapeHtml(question.questionTo?.name ?? "the PO")}</b>`,
        `${escapeHtml(question.project.name)} · <b>${escapeHtml(subject)}</b>`,
        "",
        excerpt(question.body),
      ],
      path,
    );
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
    const { question, subject, path } = found;
    const fromPo = isAdmin(reply.author.role);
    return message(
      [
        fromPo
          ? `✅ <b>${escapeHtml(reply.author.name)}</b> answered <b>${escapeHtml(question.asker.name)}</b>`
          : `↩️ <b>${escapeHtml(reply.author.name)}</b> followed up`,
        `${escapeHtml(question.project.name)} · <b>${escapeHtml(subject)}</b>`,
        "",
        excerpt(reply.body),
      ],
      path,
    );
  });
}

/** A comment, a reply, or the PO's answer in a test case's discussion. */
export function telegramCommentPosted(commentId: string) {
  void send(async () => {
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        body: true,
        kind: true,
        answerToId: true,
        author: { select: { name: true } },
        answerTo: { select: { author: { select: { name: true } } } },
        testCase: {
          select: { id: true, tcId: true, title: true, projectId: true, project: { select: { name: true } } },
        },
      },
    });
    if (!comment) return null;
    const who = `<b>${escapeHtml(comment.author.name)}</b>`;
    const headline =
      comment.kind === "ANSWER"
        ? `✅ ${who} answered <b>${escapeHtml(comment.answerTo?.author.name ?? "a question")}</b>`
        : comment.answerToId
          ? `↩️ ${who} replied to <b>${escapeHtml(comment.answerTo?.author.name ?? "a comment")}</b>`
          : `💬 ${who} commented`;
    const { testCase } = comment;
    return message(
      [
        headline,
        `${escapeHtml(testCase.project.name)} · <b>${escapeHtml(testCase.tcId)}</b> ${escapeHtml(testCase.title)}`,
        "",
        excerpt(comment.body),
      ],
      `/projects/${testCase.projectId}/test-cases/${testCase.id}#discussion`,
    );
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
    return message(
      [
        `📋 <b>${waiting} requirement${waiting === 1 ? "" : "s"}</b> to verify — PO, please review`,
        `${escapeHtml(doc.project.name)} · ${escapeHtml(doc.title)} v${doc.version}`,
      ],
      `/projects/${doc.projectId}/requirements?tab=requirements`,
    );
  });
}
