import { describe, expect, it } from "vitest";

import { bugReportText } from "./bug-report";

const testCase = {
  tcId: "TC-AI-01",
  title: "Create a customer",
  platform: "Web",
  preconditions: "Signed in as a clerk",
  steps: "Open the Customers page\nClick New, then Customer\nSave",
  expectedResult: "The customer is listed.",
};
const execution = {
  environmentName: "UAT",
  actualResult: "At step 3 (Save): the text “Customer saved” did not appear within 5 s.",
};

describe("bugReportText", () => {
  it("is the team's template, and nothing more", () => {
    expect(bugReportText({ testCase, execution })).toBe(
      [
        "[TC-AI-01] Create a customer",
        "",
        "1. Environment / platform: UAT / Web",
        "",
        "2. Steps to reproduce",
        "Preconditions: Signed in as a clerk",
        "1. Open the Customers page",
        "2. Click New, then Customer",
        "3. Save",
        "",
        "3. Expected result",
        "The customer is listed.",
        "",
        "4. Actual result",
        "At step 3 (Save): the text “Customer saved” did not appear within 5 s.",
      ].join("\n"),
    );
  });

  it("keeps steps already numbered, and says what is missing", () => {
    const text = bugReportText({
      testCase: { ...testCase, preconditions: null, steps: "1. Open\n2. Save", expectedResult: null },
      execution: { environmentName: null, actualResult: null },
    });
    expect(text).toContain("1. Environment / platform: Not recorded / Web");
    expect(text).toContain("2. Steps to reproduce\n1. Open\n2. Save\n");
    expect(text).toContain("3. Expected result\nNot written in the test case");
    expect(text.endsWith("4. Actual result\nNot written")).toBe(true);
  });
});
