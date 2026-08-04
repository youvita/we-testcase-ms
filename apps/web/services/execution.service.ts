import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { forbidden, notFound } from "@/lib/api";
import { isAdmin } from "@/lib/permissions";
import type { Role } from "@/lib/constants";
import type { ExecutionInput } from "@/lib/validations";
import type { ExecutionWithDetails } from "@/types";

const testerSelect = {
  select: { id: true, name: true, email: true, image: true },
} as const;

/**
 * Record an execution result.
 *
 * Writes the immutable history row *and* refreshes the denormalized
 * `TestCase.status` / `lastExecutedAt` in one transaction, so the list view and
 * dashboard can never disagree with the history.
 *
 * This is the only place allowed to write `TestCase.status`.
 */
export async function recordExecution(
  testCaseId: string,
  testerId: string,
  input: ExecutionInput & { status: NonNullable<ExecutionInput["status"]> },
): Promise<ExecutionWithDetails> {
  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { id: true },
  });
  if (!testCase) throw notFound("Test case");

  const executedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const execution = await tx.testExecution.create({
      data: {
        testCaseId,
        testerId,
        status: input.status,
        actualResult: input.actualResult ?? null,
        comment: input.comment ?? null,
        executedAt,
      },
      include: { tester: testerSelect, attachments: true },
    });

    await tx.testCase.update({
      where: { id: testCaseId },
      data: {
        status: input.status,
        // Reverting a case to "Not Run" clears the timestamp so the dashboard's
        // executed count and the "last run" column stay consistent.
        lastExecutedAt: input.status === "NOT_RUN" ? null : executedAt,
        // A fresh test result answers whatever the developer last claimed, so
        // the triage flag resets. Without this, "Fixed — ready for retest"
        // would still be showing after the retest had already happened.
        fixStatus: "NONE",
        fixStatusAt: null,
        fixStatusById: null,
      },
    });

    return execution;
  });
}

/**
 * Correct a recorded result in place.
 *
 * Status, actual result and comment are all editable. `testerId` and
 * `executedAt` are not — they record who ran the test and when, which an edit
 * does not change.
 *
 * Because `TestCase.status` is denormalized from the newest execution, an edit
 * has to refresh it rather than write the edited row's status blindly: editing
 * an *older* entry must leave the case reading from the latest one. The whole
 * thing runs in a transaction so the list and the history can never disagree.
 *
 * The edit is stamped rather than silent — `editedAt`/`editedById` surface in
 * the history so a reader knows this is not what was first recorded.
 */
export async function updateExecution(
  executionId: string,
  actor: { id: string; role: Role },
  input: ExecutionInput & { status: NonNullable<ExecutionInput["status"]> },
): Promise<ExecutionWithDetails> {
  const execution = await prisma.testExecution.findUnique({
    where: { id: executionId },
    select: { id: true, testerId: true, testCaseId: true },
  });
  if (!execution) throw notFound("Execution");

  if (execution.testerId !== actor.id && !isAdmin(actor.role)) {
    throw forbidden("You can only edit results you recorded");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.testExecution.update({
      where: { id: executionId },
      data: {
        status: input.status,
        actualResult: input.actualResult ?? null,
        comment: input.comment ?? null,
        editedAt: new Date(),
        editedById: actor.id,
      },
      include: { tester: testerSelect, attachments: true },
    });

    await refreshTestCaseStatus(tx, execution.testCaseId);

    return updated;
  });
}

/**
 * Recompute the denormalized `TestCase.status` / `lastExecutedAt` from whichever
 * execution is newest.
 *
 * `recordExecution` can set these directly because the row it just wrote is by
 * definition the newest. An edit cannot: the row being changed may be any entry
 * in the history.
 */
async function refreshTestCaseStatus(
  tx: Prisma.TransactionClient,
  testCaseId: string,
) {
  const latest = await tx.testExecution.findFirst({
    where: { testCaseId },
    orderBy: { executedAt: "desc" },
    select: { status: true, executedAt: true },
  });

  await tx.testCase.update({
    where: { id: testCaseId },
    data: {
      status: latest?.status ?? "NOT_RUN",
      lastExecutedAt:
        !latest || latest.status === "NOT_RUN" ? null : latest.executedAt,
    },
  });
}

export async function listExecutions(
  testCaseId: string,
): Promise<ExecutionWithDetails[]> {
  return prisma.testExecution.findMany({
    where: { testCaseId },
    orderBy: { executedAt: "desc" },
    include: { tester: testerSelect, attachments: true },
  });
}

export async function getExecution(executionId: string) {
  const execution = await prisma.testExecution.findUnique({
    where: { id: executionId },
    include: {
      tester: testerSelect,
      attachments: true,
      testCase: { select: { id: true, projectId: true, tcId: true } },
    },
  });
  if (!execution) throw notFound("Execution");
  return execution;
}

/** Latest execution per test case for a project, keyed by test case id. */
export async function getLatestExecutions(projectId: string) {
  const executions = await prisma.testExecution.findMany({
    where: { testCase: { projectId } },
    orderBy: { executedAt: "desc" },
    include: { tester: testerSelect, attachments: true },
  });

  const latest = new Map<string, (typeof executions)[number]>();
  for (const execution of executions) {
    // findMany is ordered newest-first, so the first hit per case wins.
    if (!latest.has(execution.testCaseId)) {
      latest.set(execution.testCaseId, execution);
    }
  }
  return latest;
}
