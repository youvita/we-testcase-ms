import { prisma } from "@/lib/prisma";
import type { DailyExecutionPoint, DashboardSummary } from "@/types";
import { buildBreakdown } from "@/utils/stats";

import { getModuleProgress } from "./module.service";

const DAILY_WINDOW_DAYS = 14;

/**
 * Daily execution counts for the trend chart.
 *
 * Uses a raw query because Prisma cannot group by a truncated date. Counts
 * execution *events*, not test cases, so re-running a case shows up as new
 * activity on that day.
 */
/** Every day in the window at zero, so the chart has no gaps. */
function emptyWindow(since: Date): DailyExecutionPoint[] {
  const points: DailyExecutionPoint[] = [];
  for (let i = 0; i < DAILY_WINDOW_DAYS; i += 1) {
    const day = new Date(since);
    day.setUTCDate(since.getUTCDate() + i);
    points.push({
      date: day.toISOString().slice(0, 10),
      passed: 0,
      failed: 0,
      blocked: 0,
      total: 0,
    });
  }
  return points;
}

async function getDailyExecutions(
  projectId?: string,
  /** When present, count only executions in these projects. */
  projectIds?: string[],
): Promise<DailyExecutionPoint[]> {
  type Row = {
    day: Date;
    status: string;
    count: bigint;
  };

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (DAILY_WINDOW_DAYS - 1));

  // An empty scope means "no projects", which must return no rows rather than
  // falling through to the unscoped query.
  const scoped = projectIds ?? null;
  if (scoped && scoped.length === 0) return emptyWindow(since);

  const rows = projectId
    ? await prisma.$queryRaw<Row[]>`
        SELECT date_trunc('day', e."executedAt") AS day,
               e."status"                        AS status,
               COUNT(*)                          AS count
        FROM "TestExecution" e
        JOIN "TestCase" t ON t."id" = e."testCaseId"
        WHERE e."executedAt" >= ${since}
          AND t."projectId" = ${projectId}
        GROUP BY 1, 2
        ORDER BY 1 ASC
      `
    : scoped
      ? await prisma.$queryRaw<Row[]>`
        SELECT date_trunc('day', e."executedAt") AS day,
               e."status"                        AS status,
               COUNT(*)                          AS count
        FROM "TestExecution" e
        JOIN "TestCase" t ON t."id" = e."testCaseId"
        WHERE e."executedAt" >= ${since}
          AND t."projectId" = ANY(${scoped})
        GROUP BY 1, 2
        ORDER BY 1 ASC
      `
      : await prisma.$queryRaw<Row[]>`
        SELECT date_trunc('day', e."executedAt") AS day,
               e."status"                        AS status,
               COUNT(*)                          AS count
        FROM "TestExecution" e
        WHERE e."executedAt" >= ${since}
        GROUP BY 1, 2
        ORDER BY 1 ASC
      `;

  const byDate = new Map(emptyWindow(since).map((point) => [point.date, point]));

  for (const row of rows) {
    const key = new Date(row.day).toISOString().slice(0, 10);
    const point = byDate.get(key);
    if (!point) continue;

    const count = Number(row.count);
    if (row.status === "PASSED") point.passed += count;
    else if (row.status === "FAILED") point.failed += count;
    else if (row.status === "BLOCKED") point.blocked += count;
    point.total += count;
  }

  return [...byDate.values()];
}

/**
 * Dashboard across the projects a viewer can open.
 *
 * `projectIds` comes from the caller's already-filtered project list, so the
 * headline numbers never describe projects the viewer cannot reach. Omit it only
 * for genuinely org-wide reporting.
 */
export async function getDashboardSummary(
  projectIds?: string[],
): Promise<DashboardSummary> {
  const scope = projectIds ? { id: { in: projectIds } } : {};

  const [totalProjects, activeProjects, grouped, daily] = await Promise.all([
    prisma.project.count({ where: scope }),
    prisma.project.count({ where: { ...scope, status: "ACTIVE" } }),
    prisma.testCase.groupBy({
      by: ["status"],
      ...(projectIds ? { where: { projectId: { in: projectIds } } } : {}),
      _count: { _all: true },
    }),
    getDailyExecutions(undefined, projectIds),
  ]);

  const stats = buildBreakdown(
    Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
  );

  // Org-wide module progress is not meaningful (module names repeat across
  // projects), so surface the busiest projects' modules instead: the dashboard
  // renders per-project progress and links through.
  return {
    totalProjects,
    activeProjects,
    stats,
    moduleProgress: [],
    daily,
  };
}

/** Dashboard scoped to one project. */
export async function getProjectDashboard(
  projectId: string,
): Promise<DashboardSummary> {
  const [grouped, moduleProgress, daily] = await Promise.all([
    prisma.testCase.groupBy({
      by: ["status"],
      where: { projectId },
      _count: { _all: true },
    }),
    getModuleProgress(projectId),
    getDailyExecutions(projectId),
  ]);

  return {
    totalProjects: 1,
    activeProjects: 1,
    stats: buildBreakdown(
      Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
    ),
    moduleProgress,
    daily,
  };
}

/** Most recent executions across all projects, for the dashboard activity list. */
export async function getRecentActivity(limit = 8, projectIds?: string[]) {
  return prisma.testExecution.findMany({
    // Scoped for the same reason as the summary: activity names a test case, and
    // that name should not surface from a project the viewer cannot open.
    ...(projectIds
      ? { where: { testCase: { projectId: { in: projectIds } } } }
      : {}),
    orderBy: { executedAt: "desc" },
    take: limit,
    include: {
      tester: { select: { id: true, name: true, image: true } },
      testCase: {
        select: {
          id: true,
          tcId: true,
          title: true,
          project: { select: { id: true, name: true } },
        },
      },
    },
  });
}
