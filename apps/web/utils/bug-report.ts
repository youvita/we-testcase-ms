/**
 * A failed or blocked result as a bug report, in the team's template, ready
 * to paste into a tracker or chat:
 *
 *   1. Environment / platform
 *   2. Steps to reproduce
 *   3. Expected result
 *   4. Actual result
 *
 * Plain text and built from what the case and its result already say — no AI.
 */

export type BugReportInput = {
  testCase: {
    tcId: string;
    title: string;
    /** "Web", "Android", "iOS"… */
    platform: string;
    preconditions: string | null;
    steps: string | null;
    expectedResult: string | null;
  };
  execution: {
    environmentName: string | null;
    actualResult: string | null;
  };
};

/** "1. Open…\n2. Click…" — numbered, whether the case numbered them or not. */
function numbered(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const already = lines.every((line) => /^(\d+[.)]|[-*•])\s/.test(line));
  return lines
    .map((line, i) => (already ? line.replace(/^[-*•]\s/, `${i + 1}. `) : `${i + 1}. ${line}`))
    .join("\n");
}

export function bugReportText({ testCase, execution }: BugReportInput): string {
  const environment = execution.environmentName ?? "Not recorded";
  const steps = [
    testCase.preconditions?.trim() && `Preconditions: ${testCase.preconditions.trim()}`,
    testCase.steps?.trim() ? numbered(testCase.steps) : "Not written in the test case",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    `[${testCase.tcId}] ${testCase.title}`,
    "",
    `1. Environment / platform: ${environment} / ${testCase.platform}`,
    "",
    "2. Steps to reproduce",
    steps,
    "",
    "3. Expected result",
    testCase.expectedResult?.trim() || "Not written in the test case",
    "",
    "4. Actual result",
    execution.actualResult?.trim() || "Not written",
  ].join("\n");
}
