import { describe, expect, it } from "vitest";

import { visibleStages } from "./fix-timeline";

const someone = { by: "Alice Admin", at: new Date("2026-10-23T07:57:00Z") };
const none = { failed: someone, investigating: null, fixed: null, retesting: null, passed: null };

const labels = (stages: { label: string }[]) => stages.map((stage) => stage.label);

describe("visibleStages", () => {
  it("shows only QA failed → Passed when the retest passed with no steps between", () => {
    expect(labels(visibleStages("PASSED", { ...none, passed: someone }))).toEqual([
      "QA failed",
      "Passed",
    ]);
  });

  it("keeps the steps someone actually took before it passed", () => {
    const stages = visibleStages("PASSED", {
      ...none,
      investigating: someone,
      fixed: someone,
      passed: someone,
    });
    expect(labels(stages)).toEqual(["QA failed", "Developer investigating", "Fix ready", "Passed"]);
  });

  it("shows the whole road while the case is still open", () => {
    expect(visibleStages("FAILED", none)).toHaveLength(5);
  });
});
