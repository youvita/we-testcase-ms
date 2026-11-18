import type { VerifyReminderInput } from "@wetestcase/dto";

import { badRequest, HttpError, notFound } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { formatRelative } from "@/utils/format";

import { listAdmins } from "./clarification.service";
import { telegramVerifyReminder } from "./telegram.service";

/**
 * Reminding the PO that requirements are waiting to be verified — test cases
 * drafted from an unverified requirement may test the wrong thing.
 *
 * It goes to the project's product owner, or every active admin while it has
 * none: in their bell, opening the requirements still to verify, and to the
 * team's Telegram chat. At most one an hour per project, so a PO is reminded,
 * not spammed.
 */

const COOLDOWN_MS = 60 * 60 * 1000;

export type LastReminder = { by: string; at: string } | null;

/** The project's latest reminder: who sent it, and when. */
export async function lastVerifyReminder(projectId: string): Promise<LastReminder> {
  const row = await prisma.notification.findFirst({
    where: { projectId, kind: "REQUIREMENTS_TO_VERIFY" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, actor: { select: { name: true } } },
  });
  return row ? { by: row.actor.name, at: row.createdAt.toISOString() } : null;
}

/** Who a reminder goes to: the project's PO, or every admin while it has none. */
async function poOf(projectId: string): Promise<{ id: string; name: string }[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { productOwner: { select: { id: true, name: true, isActive: true } } },
  });
  if (!project) throw notFound("Project");
  const owner = project.productOwner;
  return owner?.isActive ? [{ id: owner.id, name: owner.name }] : listAdmins();
}

export async function remindToVerify(
  projectId: string,
  actor: { id: string; name: string },
  input: VerifyReminderInput,
): Promise<{ waiting: number; to: string[] }> {
  const waiting = await prisma.requirement.count({
    where: {
      projectId,
      status: "ACTIVE",
      verifiedAt: null,
      ...(input.requirementIds ? { id: { in: input.requirementIds } } : {}),
    },
  });
  if (waiting === 0) {
    throw badRequest(input.requirementIds ? "The selected requirements are already verified." : "Every requirement is verified already.");
  }

  const last = await prisma.notification.findFirst({
    where: { projectId, kind: "REQUIREMENTS_TO_VERIFY", createdAt: { gt: new Date(Date.now() - COOLDOWN_MS) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, actor: { select: { name: true } } },
  });
  if (last) {
    throw new HttpError(
      429,
      `${last.actor.name} reminded the PO ${formatRelative(last.createdAt)} — one reminder an hour is enough.`,
    );
  }

  const recipients = (await poOf(projectId)).filter((person) => person.id !== actor.id);
  if (recipients.length === 0) throw badRequest("There is no product owner or admin to remind.");

  const headline = `${waiting} requirement${waiting === 1 ? " is" : "s are"} waiting for you to verify.`;
  const note = input.note ? `${headline} ${input.note}` : headline;
  await prisma.notification.createMany({
    data: recipients.map((person) => ({
      kind: "REQUIREMENTS_TO_VERIFY" as const,
      recipientId: person.id,
      actorId: actor.id,
      projectId,
      note,
    })),
  });
  telegramVerifyReminder(projectId, actor.name, waiting, input.note ?? null);
  return { waiting, to: recipients.map((person) => person.name) };
}
