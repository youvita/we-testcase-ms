import { describe, expect, it } from "vitest";

import { EMPTY_BREAKDOWN, buildBreakdown, sumBreakdowns } from "./stats";

describe("buildBreakdown", () => {
  it("computes execution and pass rates from executed cases only", () => {
    expect(buildBreakdown({ PASSED: 6, FAILED: 2, BLOCKED: 0, NOT_RUN: 2 })).toEqual({
      total: 10,
      passed: 6,
      failed: 2,
      blocked: 0,
      notRun: 2,
      executed: 8,
      executionRate: 80,
      passRate: 75,
    });
  });

  it("reports 0% rather than NaN when nothing exists or ran", () => {
    expect(EMPTY_BREAKDOWN.executionRate).toBe(0);
    expect(EMPTY_BREAKDOWN.passRate).toBe(0);
    expect(buildBreakdown({ NOT_RUN: 4 }).passRate).toBe(0);
  });

  it("rounds to whole percentages", () => {
    expect(buildBreakdown({ PASSED: 1, FAILED: 2 }).passRate).toBe(33);
  });
});

describe("sumBreakdowns", () => {
  it("adds counts and recomputes the rates", () => {
    const total = sumBreakdowns([
      buildBreakdown({ PASSED: 1, NOT_RUN: 1 }),
      buildBreakdown({ FAILED: 1, BLOCKED: 1 }),
    ]);
    expect(total.total).toBe(4);
    expect(total.executed).toBe(3);
    expect(total.passRate).toBe(33);
  });
});
