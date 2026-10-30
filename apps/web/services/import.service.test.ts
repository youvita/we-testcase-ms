import { describe, expect, it } from "vitest";

import { workbook } from "@/test/workbook";

import { parseWorkbook } from "./import.service";

const HEADER = ["TC ID", "Module", "Test Case", "Steps", "Expected Result", "Priority"];

describe("parseWorkbook", () => {
  it("skips a title row above the real headings", () => {
    const parsed = parseWorkbook(
      workbook({
        Cases: [
          ["ACME Sprint 12 — Regression"],
          HEADER,
          ["TC-001", "Login", "Valid sign-in", "1. Enter\n2. Submit", "Home page", "P0"],
        ],
      }),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      row: 3,
      tcId: "TC-001",
      module: "Login",
      title: "Valid sign-in",
      steps: "1. Enter\n2. Submit",
      priority: "CRITICAL",
    });
  });

  it("prefers the sheet that has a title column over an instructions tab", () => {
    const parsed = parseWorkbook(
      workbook({
        Info: [["How to fill this in"], ["ID", "Notes"]],
        Cases: [HEADER, ["TC-1", "Login", "Sign in", "", "", ""]],
      }),
    );
    expect(parsed.sheetName).toBe("Cases");
  });

  it("counts blank rows, names rows without an ID, and rejects rows without a title", () => {
    const parsed = parseWorkbook(
      workbook({
        Cases: [
          HEADER,
          ["TC-1", "Login", "Sign in", "", "", ""],
          ["", "", "", "", "", ""],
          ["", "Login", "No ID here", "", "", ""],
          ["TC-3", "Login", "", "Steps but no title", "", ""],
        ],
      }),
    );
    expect(parsed.rows.map((r) => r.tcId)).toEqual(["TC-1", "ROW-4"]);
    expect(parsed.errors.map((e) => e.row)).toEqual([4, 5]);
    expect(parsed.errors[1]!.reason).toMatch(/No test case description/);
  });

  it("puts rows without a module under Unassigned", () => {
    const parsed = parseWorkbook(workbook({ Cases: [["Title"], ["Only a title"]] }));
    expect(parsed.rows[0]).toMatchObject({ module: "Unassigned", tcId: "ROW-2" });
  });

  it("reads an old 'API' test type as the API platform", () => {
    const parsed = parseWorkbook(
      workbook({ Cases: [["TC ID", "Title", "Test Type"], ["A-1", "GET /users", "API"]] }),
    );
    expect(parsed.rows[0]!.platform).toBe("API");
  });

  it("refuses a sheet with no recognisable header", () => {
    expect(() => parseWorkbook(workbook({ Sheet1: [["foo", "bar"], ["1", "2"]] }))).toThrow(
      /Could not find a header row/,
    );
  });

  it("refuses something that is not a spreadsheet", () => {
    expect(() => parseWorkbook(Buffer.from([0x00, 0x01, 0x02, 0xff]))).toThrow();
  });
});
