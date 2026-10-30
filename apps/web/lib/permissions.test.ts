import { describe, expect, it } from "vitest";

import * as can from "./permissions";

/** The README's role table, row by row: [Admin, QA, Developer]. */
const TABLE: [keyof typeof can, [boolean, boolean, boolean]][] = [
  ["canViewTestData", [true, true, true]],
  ["canExportReports", [true, true, true]],
  ["canComment", [true, true, true]],
  ["canManageProjects", [true, true, false]],
  ["canManageTestCases", [true, true, false]],
  ["canExecuteTests", [true, true, false]],
  ["canMarkRetesting", [true, true, false]],
  ["canSetFixStatus", [true, false, true]],
  ["canManageUsers", [true, false, false]],
];

describe("permissions", () => {
  it.each(TABLE)("%s", (name, [admin, qa, developer]) => {
    const check = can[name] as (role: string) => boolean;
    expect([check("ADMIN"), check("QA"), check("DEVELOPER")]).toEqual([admin, qa, developer]);
  });

  it("grants nothing to a missing or unknown role", () => {
    for (const [name] of TABLE) {
      const check = can[name] as (role: string | null | undefined) => boolean;
      expect(check(undefined)).toBe(false);
      expect(check(null)).toBe(false);
      expect(check("admin")).toBe(false);
    }
  });
});
