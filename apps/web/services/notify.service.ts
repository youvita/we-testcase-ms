import { prisma } from "@/lib/prisma";
import { ROLE_LABELS } from "@/lib/constants";
import { appLink, isTelegramConfigured, sendTelegram } from "@/lib/telegram";
import { toRole } from "@wetestcase/dto";

/**
 * What the team hears about outside the app.
 *
 * Three things reach the Telegram group: a new comment on a test case, a
 * comment raised as a question for the product owner, and a requirement saved
 * with open questions. All three are someone waiting on a person who is not
 * looking at the app.
 *
 * Every function here is called after the response has been sent, so none of
 * them may throw: the caller is gone, and a failed notification must not undo
 * a comment that was posted. They load what they need themselves rather than
 * take it from the caller, which keeps the services that write the rows free
 * of notification concerns — those also run from imports and AI jobs, where
 * a message to the group would be noise.
 */

/** Long enough to read in a notification, short of Telegram's own ceiling. */
const QUOTE_CHARS = 1200;

function quote(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > QUOTE_CHARS
    ? `${trimmed.slice(0, QUOTE_CHARS)}…`
    : trimmed;
}

function who(author: { name: string; role: string }): string {
  return `${author.name} (${ROLE_LABELS[toRole(author.role)]})`;
}

/** Drops the lines a missing link or empty field would otherwise leave blank. */
function message(lines: (string | null)[]): string {
  return lines.filter((line) => line !== null).join("\n");
}

export async function notifyNewComment(commentId: string): Promise<void> {
  if (!isTelegramConfigured()) return;

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      body: true,
      kind: true,
      author: { select: { name: true, role: true } },
      testCase: {
        select: {
          id: true,
          tcId: true,
          title: true,
          projectId: true,
          project: { select: { name: true } },
        },
      },
    },
  });
  if (!comment) return;

  const { testCase } = comment;
  const question = comment.kind === "PO_QUESTION";

  await sendTelegram(
    message([
      question
        ? `❓ Question for the product owner · ${testCase.tcId}`
        : `💬 New comment · ${testCase.tcId}`,
      `${testCase.project.name} — ${testCase.title}`,
      who(comment.author),
      "",
      quote(comment.body),
      appLink(`/projects/${testCase.projectId}/test-cases/${testCase.id}`),
    ]),
  );
}

/**
 * A requirement saved with open questions.
 *
 * `previous` is what the field held before the save, so re-saving a
 * requirement for an unrelated edit does not ask the product owner the same
 * thing again. A cleared field says nothing — the asking is what is worth
 * hearing about, not the answering.
 */
export async function notifyRequirementQuestions(
  requirementId: string,
  actor: { name: string; role: string },
  previous: string | null,
): Promise<void> {
  if (!isTelegramConfigured()) return;

  const requirement = await prisma.requirement.findUnique({
    where: { id: requirementId },
    select: {
      code: true,
      title: true,
      openQuestions: true,
      projectId: true,
      project: { select: { name: true } },
      doc: { select: { title: true } },
    },
  });

  if (!requirement) return;

  const questions = requirement.openQuestions?.trim();
  if (!questions || questions === previous?.trim()) return;

  await sendTelegram(
    message([
      `❓ Open questions for the product owner · ${requirement.code}`,
      `${requirement.project.name} — ${requirement.doc.title}`,
      requirement.title,
      `Raised by ${who(actor)}`,
      "",
      quote(questions),
      appLink(`/projects/${requirement.projectId}/requirements`),
    ]),
  );
}
