import type { FixStatus, Prisma } from "@prisma/client";

import { includingTrash, prisma } from "@/lib/prisma";
import { conflict, forbidden, notFound } from "@/lib/api";
import { canMarkRetesting, canSetFixStatus } from "@/lib/permissions";
import type { Role } from "@/lib/constants";
import type { TestCaseInput, TestCaseQuery } from "@/lib/validations";
import type {
  Paginated,
  TestCaseListItem,
  TestCaseWithDetails,
} from "@/types";
import type { CaseTextInput, TestCaseSource, TrashedTestCase } from "@wetestcase/dto";

import { resolveProjectPlatform } from "./project.service";

const testerSelect = {
  select: { id: true, name: true, email: true, image: true },
} as const;

/** The sub-module filter's value for cases that have none. */
export const NO_SUB_MODULE = "-";

export function buildWhere(
  projectId: string,
  query: Partial<TestCaseQuery>,
): Prisma.TestCaseWhereInput {
  const search = query.search?.trim();

  return {
    projectId,
    ...(query.moduleId ? { moduleId: query.moduleId } : {}),
    ...(query.subModule
      ? { subModule: query.subModule === NO_SUB_MODULE ? null : query.subModule }
      : {}),
    ...(query.testType ? { testType: query.testType } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.fixStatus ? { fixStatus: query.fixStatus } : {}),
    ...(query.platform ? { platform: query.platform } : {}),
    ...(query.automated === "yes" ? { script: { isNot: null } } : {}),
    ...(query.automated === "no" ? { script: { is: null } } : {}),
    ...(query.source ? { drafts: SOURCE_WHERE[query.source] } : {}),
    ...(query.requirementChanged === "yes"
      ? { requirements: { some: { requirementChangedAt: { not: null } } } }
      : {}),
    ...(search
      ? {
          OR: [
            { tcId: { contains: search, mode: "insensitive" } },
            { title: { contains: search, mode: "insensitive" } },
            { subModule: { contains: search, mode: "insensitive" } },
            { steps: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

/**
 * A case came from the AI when a draft was accepted into it: from requirements
 * when that draft cited one or came from generating, from exploring when it
 * came from an exploration — or cited nothing and its run is gone, which only
 * exploring leaves.
 */
const FROM_REQUIREMENTS: Prisma.TestCaseDraftWhereInput = {
  OR: [{ job: { kind: "GENERATE_TEST_CASES" } }, { requirementIds: { isEmpty: false } }],
};
const FROM_EXPLORING: Prisma.TestCaseDraftWhereInput = {
  OR: [{ job: { kind: "EXPLORE_APP" } }, { jobId: null, requirementIds: { isEmpty: true } }],
};
const SOURCE_WHERE: Record<TestCaseSource, Prisma.TestCaseDraftListRelationFilter> = {
  requirements: { some: FROM_REQUIREMENTS },
  explore: { some: FROM_EXPLORING, none: FROM_REQUIREMENTS },
  manual: { none: {} },
};

/** Where a case came from, by the draft accepted into it (see SOURCE_WHERE). */
export function sourceOf(
  drafts: { requirementIds: string[]; job: { kind: string } | null }[],
): TestCaseSource {
  const draft = drafts[0];
  if (!draft) return "manual";
  if (draft.job?.kind === "GENERATE_TEST_CASES" || draft.requirementIds.length > 0) return "requirements";
  return "explore";
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
      // Cases without a sub-module first within each module.
      return [
        { module: { name: order } },
        { subModule: { sort: order, nulls: "first" } },
        { tcId: "asc" },
      ];
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
        subModule: true,
        module: { select: { id: true, name: true } },
        script: { select: { updatedAt: true } },
        drafts: {
          take: 1,
          orderBy: { createdAt: "asc" },
          select: { requirementIds: true, job: { select: { kind: true } } },
        },
        requirements: {
          where: { requirementChangedAt: { not: null } },
          take: 1,
          select: { requirementId: true },
        },
      },
    }),
    prisma.testCase.count({ where }),
  ]);

  // Cases without a script that the AI has started one for — automation in
  // progress. Jobs stopped before they ran do not count.
  const unscripted = items.filter((item) => !item.script).map((item) => item.id);
  const started = new Set<string>();
  if (unscripted.length > 0) {
    const jobs = await prisma.aiJob.findMany({
      where: { projectId, kind: "WRITE_SCRIPT", NOT: { status: "FAILED", startedAt: null } },
      select: { input: true },
    });
    for (const job of jobs) {
      const testCaseId = (job.input as { testCaseId?: string } | null)?.testCaseId;
      if (testCaseId && unscripted.includes(testCaseId)) started.add(testCaseId);
    }
  }

  return {
    items: items.map(({ drafts, requirements, ...item }) => ({
      ...item,
      aiScriptStarted: started.has(item.id),
      source: sourceOf(drafts),
      requirementChanged: requirements.length > 0,
    })),
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
        include: {
          tester: testerSelect,
          attachments: true,
          runItem: {
            select: { id: true, run: { select: { id: true, number: true } } },
          },
        },
      },
      fixStatusBy: { select: { id: true, name: true } },
      fixStatusEvents: {
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, name: true } } },
      },
      requirements: {
        select: {
          requirementChangedAt: true,
          requirement: {
            select: {
              id: true,
              code: true,
              title: true,
              doc: { select: { title: true, version: true } },
            },
          },
        },
        orderBy: { requirement: { code: "asc" } },
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

/**
 * Put what the PO confirmed into a case's text — from an answer on a
 * requirement it verifies, where there is no question on the case to settle.
 * As with any edit, it no longer waits on a changed requirement.
 */
export async function updateCaseText(testCaseId: string, input: CaseTextInput) {
  const testCase = await prisma.testCase.findUnique({ where: { id: testCaseId }, select: { id: true } });
  if (!testCase) throw notFound("Test case");
  return prisma.$transaction(async (tx) => {
    await tx.testCaseRequirement.updateMany({
      where: { testCaseId, requirementChangedAt: { not: null } },
      data: { requirementChangedAt: null },
    });
    return tx.testCase.update({
      where: { id: testCaseId },
      data: {
        preconditions: input.preconditions ?? null,
        steps: input.steps ?? null,
        expectedResult: input.expectedResult ?? null,
        openQuestions: input.openQuestions ?? null,
      },
      select: { id: true },
    });
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

  const platform = await resolveProjectPlatform(projectId, input.platform);

  const tcId = input.tcId.trim();
  // Unique regardless of case, as the importer treats them: "tc-1" and
  // "TC-1" would read as the same case to everyone looking at the list.
  const duplicate = await prisma.testCase.findFirst({
    where: { projectId, tcId: { equals: tcId, mode: "insensitive" }, ...includingTrash },
    select: { deletedAt: true },
  });
  if (duplicate) throw tcIdTaken(tcId, duplicate);

  return prisma.testCase.create({
    data: {
      projectId,
      moduleId: mod.id,
      subModule: input.subModule ?? null,
      tcId,
      title: input.title.trim(),
      preconditions: input.preconditions ?? null,
      steps: input.steps ?? null,
      expectedResult: input.expectedResult ?? null,
      openQuestions: input.openQuestions ?? null,
      testType: input.testType ?? "FUNCTIONAL",
      priority: input.priority ?? "MEDIUM",
      platform,
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

  const platform = await resolveProjectPlatform(
    existing.projectId,
    input.platform,
  );

  const tcId = input.tcId.trim();
  const duplicate = await prisma.testCase.findFirst({
    where: {
      projectId: existing.projectId,
      tcId: { equals: tcId, mode: "insensitive" },
      NOT: { id: testCaseId },
      ...includingTrash,
    },
    select: { deletedAt: true },
  });
  if (duplicate) throw tcIdTaken(tcId, duplicate);

  // Saved by a person who had the case open: they have seen what changed.
  await prisma.testCaseRequirement.updateMany({
    where: { testCaseId, requirementChangedAt: { not: null } },
    data: { requirementChangedAt: null },
  });

  return prisma.testCase.update({
    where: { id: testCaseId },
    data: {
      moduleId: mod.id,
      subModule: input.subModule ?? null,
      tcId,
      title: input.title.trim(),
      preconditions: input.preconditions ?? null,
      steps: input.steps ?? null,
      expectedResult: input.expectedResult ?? null,
      openQuestions: input.openQuestions ?? null,
      testType: input.testType ?? "FUNCTIONAL",
      priority: input.priority ?? "MEDIUM",
      platform,
    },
  });
}

/** QA checked the case against its changed requirements: it still holds. */
export async function confirmRequirementChanges(testCaseId: string) {
  const { count } = await prisma.testCaseRequirement.updateMany({
    where: { testCaseId, requirementChangedAt: { not: null } },
    data: { requirementChangedAt: null },
  });
  return { cleared: count };
}

/**
 * A TC ID is taken by any case in the project, one in the Trash included —
 * otherwise restoring that case would clash with the new one.
 */
function tcIdTaken(tcId: string, holder: { deletedAt: Date | null }) {
  return conflict(
    holder.deletedAt
      ? `TC ID "${tcId}" belongs to a test case in the Trash. Restore it, or delete it forever to reuse the ID.`
      : `TC ID "${tcId}" is already used in this project`,
  );
}

/** Move one test case to the project's Trash. */
export async function deleteTestCase(testCaseId: string, userId: string) {
  const { count } = await prisma.testCase.updateMany({
    where: { id: testCaseId },
    data: { deletedAt: new Date(), deletedById: userId },
  });
  if (count === 0) throw notFound("Test case");
}

/**
 * Move several test cases to the Trash in one request.
 *
 * Scoped to `projectId` so ids from another project cannot be reached by
 * pointing the request at a project the caller can see. Ids that no longer
 * exist are counted, not fatal: a browser list is a snapshot, and a case a
 * teammate already deleted should not block the rest of the selection.
 */
export async function deleteTestCases(
  projectId: string,
  ids: string[],
  userId: string,
): Promise<{ deleted: number; missing: number }> {
  const unique = [...new Set(ids)];

  const { count } = await prisma.testCase.updateMany({
    where: { projectId, id: { in: unique } },
    data: { deletedAt: new Date(), deletedById: userId },
  });

  if (count === 0) throw notFound("Test cases");

  return { deleted: count, missing: unique.length - count };
}

const inTrash = { deletedAt: { not: null } } as const;

/** The project's Trash, most recently deleted first. */
export async function listTrash(projectId: string): Promise<TrashedTestCase[]> {
  const rows = await prisma.testCase.findMany({
    where: { projectId, ...inTrash },
    orderBy: [{ deletedAt: "desc" }, { tcId: "asc" }],
    select: {
      id: true,
      tcId: true,
      title: true,
      platform: true,
      status: true,
      subModule: true,
      deletedAt: true,
      module: { select: { name: true } },
      deletedBy: { select: { name: true } },
      _count: { select: { executions: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    tcId: row.tcId,
    title: row.title,
    platform: row.platform,
    status: row.status,
    moduleName: row.module.name,
    subModule: row.subModule,
    deletedAt: row.deletedAt!.toISOString(),
    deletedByName: row.deletedBy?.name ?? null,
    executions: row._count.executions,
  }));
}

export async function countTrash(projectId: string): Promise<number> {
  return prisma.testCase.count({ where: { projectId, ...inTrash } });
}

/** Bring test cases back from the Trash, history and all. */
export async function restoreTestCases(
  projectId: string,
  ids: string[],
): Promise<{ restored: number }> {
  const { count } = await prisma.testCase.updateMany({
    where: { projectId, id: { in: [...new Set(ids)] }, ...inTrash },
    data: { deletedAt: null, deletedById: null },
  });
  if (count === 0) throw notFound("Test cases in the Trash");
  return { restored: count };
}

/**
 * Delete test cases forever, with their history, comments and scripts. Only
 * cases already in the Trash: nothing goes straight from the list to gone.
 * Without ids, empties the project's Trash.
 */
export async function purgeTestCases(
  projectId: string,
  ids?: string[],
): Promise<{ deleted: number }> {
  const { count } = await prisma.testCase.deleteMany({
    where: { projectId, ...inTrash, ...(ids ? { id: { in: [...new Set(ids)] } } : {}) },
  });
  return { deleted: count };
}

/** Put several test cases in one sub-module, or take them out of any. */
export async function setSubModule(
  projectId: string,
  ids: string[],
  subModule: string | undefined,
): Promise<{ updated: number }> {
  const { count } = await prisma.testCase.updateMany({
    where: { projectId, id: { in: [...new Set(ids)] } },
    data: { subModule: subModule ?? null },
  });
  if (count === 0) throw notFound("Test cases");
  return { updated: count };
}

/**
 * Each module's sub-modules, as its cases name them — for filters, the form's
 * suggestions and picking part of a module for a run.
 */
export async function listSubModules(
  projectId: string,
): Promise<{ moduleId: string; name: string; count: number }[]> {
  const groups = await prisma.testCase.groupBy({
    by: ["moduleId", "subModule"],
    where: { projectId, subModule: { not: null } },
    _count: { _all: true },
    orderBy: [{ moduleId: "asc" }, { subModule: "asc" }],
  });
  return groups.map((group) => ({
    moduleId: group.moduleId,
    name: group.subModule!,
    count: group._count._all,
  }));
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
