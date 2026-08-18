import type { FixStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { conflict, forbidden, notFound } from "@/lib/api";
import { canMarkRetesting, canSetFixStatus } from "@/lib/permissions";
import type { Role } from "@/lib/constants";
import type { TestCaseInput, TestCaseQuery } from "@/lib/validations";
import type {
  Paginated,
  TestCaseListItem,
  TestCaseWithDetails,
} from "@/types";

const testerSelect = {
  select: { id: true, name: true, email: true, image: true },
} as const;

function buildWhere(
  projectId: string,
  query: Partial<TestCaseQuery>,
): Prisma.TestCaseWhereInput {
  const search = query.search?.trim();

  return {
    projectId,
    ...(query.moduleId ? { moduleId: query.moduleId } : {}),
    ...(query.testType ? { testType: query.testType } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.fixStatus ? { fixStatus: query.fixStatus } : {}),
    ...(search
      ? {
          OR: [
            { tcId: { contains: search, mode: "insensitive" } },
            { title: { contains: search, mode: "insensitive" } },
            { steps: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function buildOrderBy(
  query: Partial<TestCaseQuery>,
): Prisma.TestCaseOrderByWithRelationInput[] {
  const order = query.order ?? "asc";

  switch (query.sort) {
    case "testType":
      // Postgres orders enums by their declaration order in schema.prisma,
      // so this follows TEST_TYPES order rather than alphabetical.
      return [{ testType: order }, { tcId: "asc" }];
    case "priority":
      // Priority enum is declared most-severe-first, so ascending puts
      // Critical ahead of Low.
      return [{ priority: order }, { tcId: "asc" }];
    case "module":
      return [{ module: { name: order } }, { tcId: "asc" }];
    case "updatedAt":
      return [{ updatedAt: order }];
    case "tcId":
    default:
      // Natural, not lexicographic: the column carries the `natural_sort` ICU
      // collation (see the 20260804090000 migration), so TC-2 sorts before
      // TC-10 whether or not the IDs are zero-padded.
      return [{ tcId: order }];
  }
}

export async function listTestCases(
  projectId: string,
  query: TestCaseQuery,
): Promise<Paginated<TestCaseListItem>> {
  const where = buildWhere(projectId, query);
  const skip = (query.page - 1) * query.pageSize;

  const [items, total] = await Promise.all([
    prisma.testCase.findMany({
      where,
      orderBy: buildOrderBy(query),
      skip,
      take: query.pageSize,
      select: {
        id: true,
        tcId: true,
        title: true,
        testType: true,
        priority: true,
        platform: true,
        status: true,
        fixStatus: true,
        lastExecutedAt: true,
        updatedAt: true,
        moduleId: true,
        module: { select: { id: true, name: true } },
      },
    }),
    prisma.testCase.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getTestCase(
  testCaseId: string,
): Promise<TestCaseWithDetails> {
  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    include: {
      module: { select: { id: true, name: true } },
      project: {
        select: { id: true, name: true, version: true, environment: true },
      },
      executions: {
        orderBy: { executedAt: "desc" },
        include: { tester: testerSelect, attachments: true },
      },
      fixStatusBy: { select: { id: true, name: true } },
      fixStatusEvents: {
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, name: true } } },
      },
    },
  });
  if (!testCase) throw notFound("Test case");
  return testCase;
}

/**
 * Set the developer-owned triage state.
 *
 * Kept apart from `recordExecution`, which owns `status`: neither function may
 * write the other's field, which is what keeps "what testing found" and "what
 * engineering says" from overwriting each other.
 */
export async function setFixStatus(
  testCaseId: string,
  actor: { id: string; role: Role },
  fixStatus: FixStatus,
  note?: string,
) {
  const testCase = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { id: true, fixStatus: true },
  });
  if (!testCase) throw notFound("Test case");

  // Who owns which value. Enforced here rather than only in the route so every
  // caller gets the same rule.
  const allowed = (() => {
    // Claiming a retest is QA's alone — a developer cannot know that someone
    // has started re-running the case.
    if (fixStatus === "RETESTING") return canMarkRetesting(actor.role);

    // Dropping back to "fix ready" from a retest is QA undoing their own claim,
    // and is also a developer re-flagging. Both are legitimate.
    if (fixStatus === "FIXED" && testCase.fixStatus === "RETESTING") {
      return canMarkRetesting(actor.role) || canSetFixStatus(actor.role);
    }

    // Clearing is open to whoever could have set the value in the first place.
    if (fixStatus === "NONE") {
      return canMarkRetesting(actor.role) || canSetFixStatus(actor.role);
    }

    return canSetFixStatus(actor.role);
  })();

  if (!allowed) {
    throw forbidden(
      fixStatus === "RETESTING"
        ? "Only QA can mark a case as being retested"
        : "Only a developer can set this update",
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.testCase.update({
      where: { id: testCaseId },
      data: {
        fixStatus,
        // Clearing the flag clears its provenance too, so the UI never shows
        // "set by X" against no status.
        fixStatusAt: fixStatus === "NONE" ? null : new Date(),
        fixStatusById: fixStatus === "NONE" ? null : actor.id,
      },
      include: { fixStatusBy: { select: { id: true, name: true } } },
    });

    // Logged as well as stored: the current value alone cannot tell the
    // progress timeline when an earlier stage was reached, or by whom.
    //
    // Clearing is logged too, even though NONE is not a stage — it is the line
    // that ends a round. Without the marker, a withdrawn update would keep
    // showing its author against a stage nobody is on any more.
    await tx.fixStatusEvent.create({
      data: { testCaseId, actorId: actor.id, fixStatus, note: note ?? null },
    });

    return updated;
  });
}

/** Neighbouring case ids so the detail page can offer Previous/Next. */
export async function getTestCaseNeighbours(
  projectId: string,
  tcId: string,
): Promise<{ prevId: string | null; nextId: string | null }> {
  const [prev, next] = await Promise.all([
    prisma.testCase.findFirst({
      where: { projectId, tcId: { lt: tcId } },
      orderBy: { tcId: "desc" },
      select: { id: true },
    }),
    prisma.testCase.findFirst({
      where: { projectId, tcId: { gt: tcId } },
      orderBy: { tcId: "asc" },
      select: { id: true },
    }),
  ]);

  return { prevId: prev?.id ?? null, nextId: next?.id ?? null };
}

export async function createTestCase(projectId: string, input: TestCaseInput) {
  const mod = await prisma.module.findFirst({
    where: { id: input.moduleId, projectId },
    select: { id: true },
  });
  if (!mod) throw notFound("Module");

  const tcId = input.tcId.trim();
  const duplicate = await prisma.testCase.findUnique({
    where: { projectId_tcId: { projectId, tcId } },
    select: { id: true },
  });
  if (duplicate) {
    throw conflict(`TC ID "${tcId}" is already used in this project`);
  }

  return prisma.testCase.create({
    data: {
      projectId,
      moduleId: mod.id,
      tcId,
      title: input.title.trim(),
      preconditions: input.preconditions ?? null,
      steps: input.steps ?? null,
      expectedResult: input.expectedResult ?? null,
      testType: input.testType ?? "FUNCTIONAL",
      priority: input.priority ?? "MEDIUM",
      platform: input.platform ?? "WEB",
    },
  });
}

export async function updateTestCase(
  testCaseId: string,
  input: TestCaseInput,
) {
  const existing = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { id: true, projectId: true },
  });
  if (!existing) throw notFound("Test case");

  const mod = await prisma.module.findFirst({
    where: { id: input.moduleId, projectId: existing.projectId },
    select: { id: true },
  });
  if (!mod) throw notFound("Module");

  const tcId = input.tcId.trim();
  const duplicate = await prisma.testCase.findFirst({
    where: {
      projectId: existing.projectId,
      tcId,
      NOT: { id: testCaseId },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw conflict(`TC ID "${tcId}" is already used in this project`);
  }

  return prisma.testCase.update({
    where: { id: testCaseId },
    data: {
      moduleId: mod.id,
      tcId,
      title: input.title.trim(),
      preconditions: input.preconditions ?? null,
      steps: input.steps ?? null,
      expectedResult: input.expectedResult ?? null,
      testType: input.testType ?? "FUNCTIONAL",
      priority: input.priority ?? "MEDIUM",
      platform: input.platform ?? "WEB",
    },
  });
}

export async function deleteTestCase(testCaseId: string) {
  const existing = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { id: true },
  });
  if (!existing) throw notFound("Test case");
  await prisma.testCase.delete({ where: { id: testCaseId } });
}

/**
 * Delete several test cases in one request.
 *
 * Scoped to `projectId` so ids from another project cannot be reached by
 * pointing the request at a project the caller can see. Ids that no longer
 * exist are counted, not fatal: a browser list is a snapshot, and a case a
 * teammate already deleted should not block the rest of the selection.
 */
export async function deleteTestCases(
  projectId: string,
  ids: string[],
): Promise<{ deleted: number; missing: number }> {
  const unique = [...new Set(ids)];

  const { count } = await prisma.testCase.deleteMany({
    where: { projectId, id: { in: unique } },
  });

  if (count === 0) throw notFound("Test cases");

  return { deleted: count, missing: unique.length - count };
}

/**
 * Failed and blocked cases with their latest execution — the Developer portal's
 * primary view.
 */
export async function listFailedTestCases(projectId: string) {
  return prisma.testCase.findMany({
    where: { projectId, status: { in: ["FAILED", "BLOCKED"] } },
    orderBy: [{ testType: "asc" }, { tcId: "asc" }],
    include: {
      module: { select: { id: true, name: true } },
      executions: {
        orderBy: { executedAt: "desc" },
        take: 1,
        include: { tester: testerSelect, attachments: true },
      },
    },
  });
}
