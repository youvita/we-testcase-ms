import { describe, expect, it } from "vitest";

import {
  cellToString,
  isApiTestTypeLabel,
  isRowEmpty,
  mapHeaders,
  normalizeHeader,
  parsePlatform,
  parsePriority,
  parseTestType,
} from "./excel";

describe("normalizeHeader", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(normalizeHeader("TC ID")).toBe("tcid");
    expect(normalizeHeader("tc_id")).toBe("tcid");
    expect(normalizeHeader("Case No.")).toBe("caseno");
  });
});

describe("mapHeaders", () => {
  it("maps the README's example headings onto one field", () => {
    for (const heading of ["TC ID", "tc_id", "Test Case ID", "Case No."]) {
      expect(mapHeaders([heading]).mapping.tcId).toBe(0);
    }
  });

  it("maps a typical template and reports what it ignored", () => {
    const result = mapHeaders([
      "TC ID",
      "Module",
      "Test Scenario",
      "Pre-conditions",
      "Test Steps",
      "Expected Result",
      "Priority",
      "Tester Notes",
    ]);
    expect(result.mapping).toEqual({
      tcId: 0,
      module: 1,
      title: 2,
      preconditions: 3,
      steps: 4,
      expectedResult: 5,
      priority: 6,
    });
    expect(result.unmappedColumns).toEqual(["Tester Notes"]);
    expect(result.mappedColumns["Test Scenario"]).toBe("title");
  });

  it("keeps the first column when two headings mean the same field", () => {
    const result = mapHeaders(["Description", "Summary"]);
    expect(result.mapping.title).toBe(0);
    expect(result.unmappedColumns).toEqual(["Summary"]);
  });

  it("skips blank headings without reporting them", () => {
    const result = mapHeaders(["", "  ", "Title"]);
    expect(result.mapping.title).toBe(2);
    expect(result.unmappedColumns).toEqual([]);
  });
});

describe("parsePriority", () => {
  it.each([
    ["P0", "CRITICAL"],
    ["Blocker", "CRITICAL"],
    ["Critical", "CRITICAL"],
    ["Major", "HIGH"],
    ["Normal", "MEDIUM"],
    ["Minor", "LOW"],
    ["Trivial", "LOW"],
  ] as const)("reads %s as %s", (cell, expected) => {
    expect(parsePriority(cell)).toBe(expected);
  });

  it("falls back to MEDIUM for blank or unknown values", () => {
    expect(parsePriority(null)).toBe("MEDIUM");
    expect(parsePriority("")).toBe("MEDIUM");
    expect(parsePriority("whenever")).toBe("MEDIUM");
  });
});

describe("parseTestType", () => {
  it("reads spelling variants as the same type", () => {
    expect(parseTestType("End-to-End")).toBe("INTEGRATION");
    expect(parseTestType("UI/UX")).toBe("UI");
    expect(parseTestType("a11y")).toBe("USABILITY");
  });

  it("falls back to FUNCTIONAL rather than dropping the row", () => {
    expect(parseTestType(undefined)).toBe("FUNCTIONAL");
    expect(parseTestType("exploratory")).toBe("FUNCTIONAL");
  });
});

describe("parsePlatform", () => {
  it("reads known platforms", () => {
    expect(parsePlatform("iPhone")).toBe("IOS");
    expect(parsePlatform("REST API")).toBe("API");
    expect(parsePlatform("Browser")).toBe("WEB");
  });

  it("returns null when blank or unknown, so the project default applies", () => {
    expect(parsePlatform("")).toBeNull();
    expect(parsePlatform("Smart TV")).toBeNull();
  });

  it("recognises the old API test type", () => {
    expect(isApiTestTypeLabel("API")).toBe(true);
    expect(isApiTestTypeLabel("Functional")).toBe(false);
  });
});

describe("cellToString", () => {
  it("trims each line of a multi-line cell but keeps the lines", () => {
    expect(cellToString("  1. Open   \r\n2. Click  \n")).toBe("1. Open\n2. Click");
  });

  it("writes dates as YYYY-MM-DD and numbers as text", () => {
    expect(cellToString(new Date("2026-03-05T00:00:00Z"))).toBe("2026-03-05");
    expect(cellToString(42)).toBe("42");
  });

  it("treats a row of blanks as empty", () => {
    expect(isRowEmpty(["", null, undefined, "   "])).toBe(true);
    expect(isRowEmpty(["", "x"])).toBe(false);
  });
});
