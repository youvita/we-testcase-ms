import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, createTestCase, resetDatabase } from "@/test/db";

import { buildExcelReport, listFilterFromQuery } from "./report.service";
import { listTestCases } from "./test-case.service";
import { testCaseQuerySchema } from "@/lib/validations";

beforeEach(resetDatabase);

function sheet(buffer: Buffer, name: string) {
  const book = XLSX.read(buffer);
  return XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets[name]!, { header: 1 });
}

describe("exporting the filtered test case list", () => {
  it("exports exactly the cases the list shows, and says how it was filtered", async () => {
    const { project, module } = await createProject();
    const checkout = await prisma.module.create({ data: { projectId: project.id, name: "Checkout" } });
    const a = await createTestCase(project.id, module.id, "TC-1", "Sign in");
    const b = await createTestCase(project.id, module.id, "TC-2", "Sign out");
    await createTestCase(project.id, checkout.id, "TC-3", "Pay");
    await prisma.testCase.update({ where: { id: a.id }, data: { status: "FAILED", priority: "HIGH" } });
    await prisma.testCase.update({ where: { id: b.id }, data: { status: "PASSED", priority: "HIGH" } });

    const params = new URLSearchParams({ moduleId: module.id, priority: "HIGH", search: "sign", page: "2" });
    // The export ignores paging: every matching case, not just the page on screen.
    const listed = await listTestCases(
      project.id,
      testCaseQuerySchema.parse({ ...Object.fromEntries(params), page: "1" }),
    );
    const list = await listFilterFromQuery(project.id, params);
    const buffer = await buildExcelReport(project.id, "cases", { filter: list!.filter, filterLabels: list!.labels });

    const summary = sheet(buffer, "Summary");
    const value = (label: string) => summary.find((row) => row[0] === label)?.[1];
    expect(value("Filters")).toBe('Search "sign", Module: Login, Priority: High');
    expect([value("Total Test Cases"), value("Passed"), value("Failed")]).toEqual([2, 1, 1]);
    // Module progress lists only the modules exported.
    expect(summary.some((row) => row[0] === "Checkout")).toBe(false);

    const rows = sheet(buffer, "Test Cases").slice(1).map((row) => row[0]);
    expect(rows).toEqual(listed.items.map((tc) => tc.tcId).sort());
    expect(rows).toEqual(["TC-1", "TC-2"]);
  });

  it("is no filter at all when the list is unfiltered", async () => {
    const { project } = await createProject();
    expect(await listFilterFromQuery(project.id, new URLSearchParams({ page: "3", sort: "priority" }))).toBeNull();
  });
});
