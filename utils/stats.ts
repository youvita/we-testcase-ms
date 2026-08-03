import type { ExecutionStatus } from "@prisma/client";

import type { StatusBreakdown } from "@/types";

/**
 * Build a StatusBreakdown from raw per-status counts.
 *
 * Centralised so the dashboard, project cards, module progress list and the
 * Excel/PDF reports all compute "execution %" and "pass rate" identically.
 */
export function buildBreakdown(
  counts: Partial<Record<ExecutionStatus, number>>,
): StatusBreakdown {
  const passed = counts.PASSED ?? 0;
  const failed = counts.FAILED ?? 0;
  const blocked = counts.BLOCKED ?? 0;
  const notRun = counts.NOT_RUN ?? 0;
  const total = passed + failed + blocked + notRun;
  const executed = total - notRun;

  return {
    total,
    passed,
    failed,
    blocked,
    notRun,
    executed,
    executionRate: total === 0 ? 0 : Math.round((executed / total) * 100),
    passRate: executed === 0 ? 0 : Math.round((passed / executed) * 100),
  };
}

export const EMPTY_BREAKDOWN: StatusBreakdown = buildBreakdown({});

/** Sum several breakdowns into one (used for cross-project totals). */
export function sumBreakdowns(items: StatusBreakdown[]): StatusBreakdown {
  return buildBreakdown({
    PASSED: items.reduce((n, i) => n + i.passed, 0),
    FAILED: items.reduce((n, i) => n + i.failed, 0),
    BLOCKED: items.reduce((n, i) => n + i.blocked, 0),
    NOT_RUN: items.reduce((n, i) => n + i.notRun, 0),
  });
}
