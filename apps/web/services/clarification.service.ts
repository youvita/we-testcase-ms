import type { Prisma } from "@prisma/client";

import { prisma, type Tx } from "@/lib/prisma";
import { badRequest, forbidden, notFound } from "@/lib/api";
import { isAdmin } from "@/lib/permissions";
import type { Role } from "@/lib/constants";
import type { CommentWithAuthor } from "@/types";
import type {
  NotificationDto,
  NotificationList,
  PoQuestionDto,
  PoQuestionInput,
  SettleAnswerInput,
} from "@wetestcase/dto";

/**
 * Asking the PO, and the answer coming back.
 *
 * POs are admins here. QA asks about a requirement or a review draft, which
 * have no discussion of their own, so the questions are PoQuestions answered
 * in place. Accepting a draft copies its questions into the case's
 * discussion as comments of their own kind, still answerable there. The
 * notification is what makes sure the PO sees a question, and the QA who
 * asked sees the answer.
 */


const commentInclude = {
  author: { select: { id: true, name: true, email: true, image: true, role: true } },
  deletedBy: { select: { id: true, name: true } },
  questionTo: { select: { id: true, name: true } },
} as const;

/** Whom QA can ask: every active admin. */
export async function listAdmins() {
  return prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** The admins a question goes to — one, or all — never the asker. */
async function recipientsFor(askerId: string, toUserId: string | undefined): Promise<string[]> {
  const admins = await listAdmins();
  if (toUserId && !admins.some((admin) => admin.id === toUserId)) {
    throw badRequest("Questions go to an admin — pick one from the list, or ask every admin.");
  }
  const recipients = (toUserId ? [toUserId] : admins.map((admin) => admin.id)).filter((id) => id !== askerId);
  if (recipients.length === 0) {
    throw badRequest("There is no other admin to ask. Add the PO as an admin user first.");
  }
  return recipients;
}

function assertCanAnswer(role: Role) {
  if (!isAdmin(role)) throw forbidden("Only an admin — the PO — answers questions");
}

// ---------------------------------------------------------------------------
// On a test case: questions in its discussion, copied from its draft
// ---------------------------------------------------------------------------

/**
 * An admin answers. The question is marked answered — the first answer
 * settles it, later ones add to it — and its author is told. Notifications
 * about the question are marked read for whoever answers it: they acted on it.
 */
export async function answerQuestion(
  questionId: string,
  answerer: { id: string; role: Role },
  body: string,
): Promise<CommentWithAuthor> {
  const question = await prisma.comment.findUnique({
    where: { id: questionId },
    select: { id: true, kind: true, testCaseId: true, authorId: true, deletedAt: true, answeredAt: true },
  });
  if (!question || question.kind !== "QUESTION" || question.deletedAt) throw notFound("Question");
  assertCanAnswer(answerer.role);

  return prisma.$transaction(async (tx) => {
    const answer = await tx.comment.create({
      data: {
        testCaseId: question.testCaseId,
        authorId: answerer.id,
        body,
        kind: "ANSWER",
        answerToId: question.id,
      },
      include: commentInclude,
    });
    if (!question.answeredAt) {
      await tx.comment.update({ where: { id: question.id }, data: { answeredAt: answer.createdAt } });
    }
    if (question.authorId !== answerer.id) {
      await tx.notification.create({
        data: {
          kind: "QUESTION_ANSWERED",
          recipientId: question.authorId,
          actorId: answerer.id,
          testCaseId: question.testCaseId,
          commentId: answer.id,
        },
      });
    }
    await tx.notification.updateMany({
      where: { commentId: question.id, recipientId: answerer.id, readAt: null },
      data: { readAt: new Date() },
    });
    return answer;
  });
}

/**
 * QA deals with the PO's answer to a question on a case: puts it into the
 * case's expected result and open questions, or records that nothing needed
 * to change. Either way the prompt goes away until the PO answers again.
 */
export async function settleAnswer(
  questionId: string,
  actor: { id: string },
  input: SettleAnswerInput,
) {
  const question = await prisma.comment.findUnique({
    where: { id: questionId },
    select: { kind: true, testCaseId: true, deletedAt: true, answeredAt: true },
  });
  if (!question || question.kind !== "QUESTION" || question.deletedAt) throw notFound("Question");
  if (!question.answeredAt) throw badRequest("The PO has not answered this question yet.");

  return prisma.$transaction(async (tx) => {
    if (input.update) {
      // Through the Trash filter: a case in the Trash cannot be edited.
      await tx.testCase.update({
        where: { id: question.testCaseId },
        data: {
          preconditions: input.update.preconditions ?? null,
          steps: input.update.steps ?? null,
          expectedResult: input.update.expectedResult ?? null,
          openQuestions: input.update.openQuestions ?? null,
        },
      });
    }
    await tx.comment.update({
      where: { id: questionId },
      data: {
        settledAt: new Date(),
        settledById: actor.id,
        settledChangedCase: Boolean(input.update),
      },
    });
    return { settled: true, changedCase: Boolean(input.update) };
  });
}

// ---------------------------------------------------------------------------
// On a requirement or a review draft
// ---------------------------------------------------------------------------

const poQuestionInclude = {
  asker: { select: { id: true, name: true, image: true } },
  questionTo: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
  replies: {
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, image: true, role: true } } },
  },
} as const;

type PoQuestionRow = Prisma.PoQuestionGetPayload<{ include: typeof poQuestionInclude }>;

function toPoQuestionDto(row: PoQuestionRow): PoQuestionDto {
  const replies = row.replies.map((reply) => ({
    id: reply.id,
    body: reply.body,
    createdAt: reply.createdAt.toISOString(),
    author: {
      id: reply.author.id,
      name: reply.author.name,
      image: reply.author.image,
      isPo: isAdmin(reply.author.role),
    },
  }));
  const last = replies.at(-1);
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    requirementId: row.requirementId,
    draftId: row.draftId,
    asker: row.asker,
    questionTo: row.questionTo,
    replies,
    status: row.resolvedAt ? "resolved" : last?.author.isPo ? "answered" : "waiting",
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy,
  };
}

/** A project's questions about its requirements and pending drafts, oldest first. */
export async function listPoQuestions(projectId: string): Promise<PoQuestionDto[]> {
  const rows = await prisma.poQuestion.findMany({
    where: {
      projectId,
      OR: [{ requirementId: { not: null } }, { draft: { status: "PENDING" } }],
    },
    orderBy: { createdAt: "asc" },
    include: poQuestionInclude,
  });
  return rows.map(toPoQuestionDto);
}

/**
 * The questions asked about the requirements a case verifies, read live from
 * the requirements' own threads — so the case's discussion shows the PO's
 * latest answers without a copy that could fall behind. Grouped by
 * requirement, in the order of their codes.
 */
export async function listRequirementQuestionsForCase(testCaseId: string): Promise<
  { requirement: { id: string; code: string; title: string }; questions: PoQuestionDto[] }[]
> {
  const links = await prisma.testCaseRequirement.findMany({
    where: { testCaseId },
    select: { requirement: { select: { id: true, code: true, title: true } } },
    orderBy: { requirement: { code: "asc" } },
  });
  if (links.length === 0) return [];
  const rows = await prisma.poQuestion.findMany({
    where: { requirementId: { in: links.map((link) => link.requirement.id) } },
    orderBy: { createdAt: "asc" },
    include: poQuestionInclude,
  });
  return links
    .map(({ requirement }) => ({
      requirement,
      questions: rows.filter((row) => row.requirementId === requirement.id).map(toPoQuestionDto),
    }))
    .filter((group) => group.questions.length > 0);
}

export async function askPoQuestion(
  projectId: string,
  asker: { id: string },
  input: PoQuestionInput,
): Promise<PoQuestionDto> {
  if (input.requirementId) {
    const requirement = await prisma.requirement.findUnique({
      where: { id: input.requirementId },
      select: { projectId: true },
    });
    if (!requirement || requirement.projectId !== projectId) throw notFound("Requirement");
  } else {
    const draft = await prisma.testCaseDraft.findUnique({
      where: { id: input.draftId! },
      select: { projectId: true, status: true },
    });
    if (!draft || draft.projectId !== projectId) throw notFound("Draft");
    if (draft.status !== "PENDING") throw badRequest("This draft has already been reviewed — ask on its test case.");
  }
  const toUserId = input.toUserId || undefined;
  const recipients = await recipientsFor(asker.id, toUserId);

  return prisma.$transaction(async (tx) => {
    const question = await tx.poQuestion.create({
      data: {
        projectId,
        requirementId: input.requirementId ?? null,
        draftId: input.draftId ?? null,
        askerId: asker.id,
        questionToId: toUserId ?? null,
        body: input.body,
      },
      include: poQuestionInclude,
    });
    await tx.notification.createMany({
      data: recipients.map((recipientId) => ({
        kind: "QUESTION_ASKED" as const,
        recipientId,
        actorId: asker.id,
        questionId: question.id,
      })),
    });
    return toPoQuestionDto(question);
  });
}

/**
 * A message under a question. From an admin it answers: the asker, and QA
 * who followed up, are told. From QA it follows up: the admins already in
 * the conversation are told — or, before any has answered, those asked.
 * Either way a resolved question opens again, and the writer's own
 * notifications about it are marked read: they have acted on them.
 */
export async function replyToPoQuestion(
  questionId: string,
  author: { id: string; role: Role },
  body: string,
): Promise<PoQuestionDto> {
  const question = await prisma.poQuestion.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      askerId: true,
      questionToId: true,
      answeredAt: true,
      replies: { select: { author: { select: { id: true, role: true } } } },
    },
  });
  if (!question) throw notFound("Question");

  const fromPo = isAdmin(author.role);
  const repliers = question.replies.map((reply) => reply.author);
  let recipients: string[];
  if (fromPo) {
    recipients = [question.askerId, ...repliers.filter((r) => !isAdmin(r.role)).map((r) => r.id)];
  } else {
    const admins = [
      ...repliers.filter((r) => isAdmin(r.role)).map((r) => r.id),
      ...(question.questionToId ? [question.questionToId] : []),
    ];
    recipients = admins.length ? admins : (await listAdmins()).map((admin) => admin.id);
  }
  recipients = [...new Set(recipients)].filter((id) => id !== author.id);

  return prisma.$transaction(async (tx) => {
    const reply = await tx.poQuestionReply.create({ data: { questionId, authorId: author.id, body } });
    await tx.poQuestion.update({
      where: { id: questionId },
      data: {
        resolvedAt: null,
        resolvedById: null,
        ...(fromPo && !question.answeredAt ? { answeredAt: reply.createdAt } : {}),
      },
    });
    await tx.notification.createMany({
      data: recipients.map((recipientId) => ({
        kind: fromPo ? ("QUESTION_ANSWERED" as const) : ("QUESTION_REPLIED" as const),
        recipientId,
        actorId: author.id,
        questionId,
        replyId: reply.id,
      })),
    });
    await tx.notification.updateMany({
      where: { questionId, recipientId: author.id, readAt: null },
      data: { readAt: new Date() },
    });
    return toPoQuestionDto(
      await tx.poQuestion.findUniqueOrThrow({ where: { id: questionId }, include: poQuestionInclude }),
    );
  });
}

/** Settle a question, or open it again: the asker, or an admin. */
export async function resolvePoQuestion(
  questionId: string,
  actor: { id: string; role: Role },
  resolved: boolean,
): Promise<PoQuestionDto> {
  const question = await prisma.poQuestion.findUnique({ where: { id: questionId }, select: { askerId: true } });
  if (!question) throw notFound("Question");
  if (question.askerId !== actor.id && !isAdmin(actor.role)) {
    throw forbidden("Only the person who asked, or an admin, can settle a question");
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.poQuestion.update({
      where: { id: questionId },
      data: resolved ? { resolvedAt: new Date(), resolvedById: actor.id } : { resolvedAt: null, resolvedById: null },
      include: poQuestionInclude,
    });
    if (resolved) {
      // Nothing left to act on.
      await tx.notification.updateMany({
        where: { questionId, recipientId: actor.id, readAt: null },
        data: { readAt: new Date() },
      });
    }
    return toPoQuestionDto(updated);
  });
}

/**
 * A draft becomes a case: its questions, and their answers, go into the
 * case's discussion so the history stays with the case.
 */
export async function copyDraftQuestionsToCase(tx: Tx, draftId: string, testCaseId: string) {
  const questions = await tx.poQuestion.findMany({
    where: { draftId },
    orderBy: { createdAt: "asc" },
    include: { replies: { orderBy: { createdAt: "asc" }, include: { author: { select: { role: true } } } } },
  });
  for (const question of questions) {
    const comment = await tx.comment.create({
      data: {
        testCaseId,
        authorId: question.askerId,
        body: question.body,
        kind: "QUESTION",
        questionToId: question.questionToId,
        answeredAt: question.answeredAt,
        createdAt: question.createdAt,
      },
    });
    // The PO's replies as answers, QA's follow-ups as comments, all under it.
    await tx.comment.createMany({
      data: question.replies.map((reply) => ({
        testCaseId,
        authorId: reply.authorId,
        body: reply.body,
        kind: isAdmin(reply.author.role) ? ("ANSWER" as const) : ("COMMENT" as const),
        answerToId: comment.id,
        createdAt: reply.createdAt,
      })),
    });
  }
}

// ---------------------------------------------------------------------------
// The bell
// ---------------------------------------------------------------------------

const notificationInclude = {
  actor: { select: { id: true, name: true } },
  testCase: { select: { id: true, tcId: true, projectId: true } },
  comment: { select: { body: true } },
  reply: { select: { body: true } },
  question: {
    select: {
      body: true,
      projectId: true,
      requirement: { select: { id: true, code: true } },
      draft: { select: { id: true, title: true, status: true, testCase: { select: { id: true, tcId: true } } } },
    },
  },
} as const;

type NotificationRow = Prisma.NotificationGetPayload<{ include: typeof notificationInclude }>;

/** What a notification is about and where it opens. */
function locate(row: NotificationRow): Pick<NotificationDto, "subject" | "href" | "excerpt"> | null {
  if (row.testCase && row.comment) {
    return {
      subject: row.testCase.tcId,
      href: `/projects/${row.testCase.projectId}/test-cases/${row.testCase.id}#discussion`,
      excerpt: excerpt(row.comment.body),
    };
  }
  const question = row.question;
  if (!question) return null;
  const text = excerpt(row.reply?.body ?? question.body);
  const requirements = `/projects/${question.projectId}/requirements`;
  if (question.requirement) {
    return { subject: question.requirement.code, href: `${requirements}?tab=requirements&focus=${question.requirement.id}`, excerpt: text };
  }
  const draft = question.draft;
  if (!draft) return null;
  // Accepted since: the questions now live in the case's discussion.
  if (draft.testCase) {
    return {
      subject: draft.testCase.tcId,
      href: `/projects/${question.projectId}/test-cases/${draft.testCase.id}#discussion`,
      excerpt: text,
    };
  }
  if (draft.status !== "PENDING") return null;
  return { subject: `draft “${draft.title}”`, href: `${requirements}?tab=drafts&focus=${draft.id}`, excerpt: text };
}

/** Newest first; notifications about withdrawn posts or rejected drafts are left out. */
export async function listNotifications(userId: string, limit = 20): Promise<NotificationList> {
  const visible: Prisma.NotificationWhereInput = {
    recipientId: userId,
    OR: [{ commentId: null }, { comment: { deletedAt: null } }],
    // A case in the Trash takes its notifications with it until restored.
    AND: [{ OR: [{ testCaseId: null }, { testCase: { deletedAt: null } }] }],
  };
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: visible,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: notificationInclude,
    }),
    prisma.notification.count({ where: { ...visible, readAt: null } }),
  ]);
  const items = rows.flatMap((row): NotificationDto[] => {
    const where = locate(row);
    if (!where) return [];
    const { id, kind, actor } = row;
    return [{ id, kind, actor, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null, ...where }];
  });
  return { unread, items };
}

/** Only ever the reader's own. */
export async function markNotificationsRead(userId: string, ids?: string[]) {
  await prisma.notification.updateMany({
    where: { recipientId: userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}

const excerpt = (body: string) => {
  const line = body.replace(/\s+/g, " ").trim();
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
};
