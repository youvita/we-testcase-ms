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
async function getDailyExecutions(
  projectId?: string,
): Promise<DailyExecutionPoint[]> {
  type Row = {
    day: Date;
    status: string;
    count: bigint;
  };

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (DAILY_WINDOW_DAYS - 1));

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
    : await prisma.$queryRaw<Row[]>`
        SELECT date_trunc('day', e."executedAt") AS day,
               e."status"                        AS status,
               COUNT(*)                          AS count
        FROM "TestExecution" e
        WHERE e."executedAt" >= ${since}
        GROUP BY 1, 2
        ORDER BY 1 ASC
      `;

  // Pre-fill every day in the window so the chart has no gaps.
  const byDate = new Map<string, DailyExecutionPoint>();
  for (let i = 0; i < DAILY_WINDOW_DAYS; i += 1) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    byDate.set(key, { date: key, passed: 0, failed: 0, blocked: 0, total: 0 });
  }

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

/** Organisation-wide dashboard. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const [totalProjects, activeProjects, grouped, daily] = await Promise.all([
    prisma.project.count(),
    prisma.project.count({ where: { status: "ACTIVE" } }),
    prisma.testCase.groupBy({ by: ["status"], _count: { _all: true } }),
    getDailyExecutions(),
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
export async function getRecentActivity(limit = 8) {
  return prisma.testExecution.findMany({
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
