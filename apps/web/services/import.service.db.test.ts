import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, createTestCase, createUser, resetDatabase } from "@/test/db";
import { workbook } from "@/test/workbook";

import { recordExecution } from "./execution.service";
import { importTestCases } from "./import.service";

const HEADER = ["TC ID", "Module", "Test Case", "Platform"];

function file(rows: unknown[][]) {
  return { buffer: workbook({ Cases: [HEADER, ...rows] }), fileName: "cases.xlsx" };
}

beforeEach(resetDatabase);

describe("importTestCases", () => {
  it("creates cases and the modules the sheet names", async () => {
    const { project } = await createProject();

    const summary = await importTestCases(
      project.id,
      file([
        ["TC-1", "Login", "Sign in", ""],
        ["TC-2", "Checkout", "Pay by card", ""],
      ]),
    );

    expect(summary).toMatchObject({ created: 2, updated: 0, modulesCreated: ["Checkout"] });
    const cases = await prisma.testCase.findMany({
      where: { projectId: project.id },
      include: { module: true },
      orderBy: { tcId: "asc" },
    });
    expect(cases.map((c) => [c.tcId, c.module.name])).toEqual([
      ["TC-1", "Login"],
      ["TC-2", "Checkout"],
    ]);
  });

  it("keeps the first of a TC ID repeated in the file", async () => {
    const { project } = await createProject();

    const summary = await importTestCases(
      project.id,
      file([
        ["TC-1", "Login", "First", ""],
        ["tc-1", "Login", "Second", ""],
      ]),
    );

    expect(summary.created).toBe(1);
    expect(summary.duplicatesInFile).toBe(1);
    const only = await prisma.testCase.findFirstOrThrow({ where: { projectId: project.id } });
    expect(only.title).toBe("First");
  });

  it("skips existing TC IDs in skip mode and leaves them untouched", async () => {
    const { project, module } = await createProject();
    await createTestCase(project.id, module.id, "TC-1", "Original");

    const summary = await importTestCases(project.id, file([["TC-1", "Login", "Changed", ""]]), "skip");

    expect(summary).toMatchObject({ created: 0, updated: 0 });
    expect(summary.errors[0]!.reason).toMatch(/already exists/);
    const tc = await prisma.testCase.findFirstOrThrow({ where: { projectId: project.id } });
    expect(tc.title).toBe("Original");
  });

  it("never overwrites recorded results when re-importing in update mode", async () => {
    const { project, module } = await createProject();
    const tester = await createUser("QA");
    const tc = await createTestCase(project.id, module.id, "TC-1", "Original");
    await recordExecution(tc.id, tester.id, { status: "FAILED", actualResult: "500 error" });

    const summary = await importTestCases(
      project.id,
      file([["TC-1", "Login", "Reworded", ""]]),
      "update",
    );

    expect(summary.updated).toBe(1);
    const after = await prisma.testCase.findUniqueOrThrow({
      where: { id: tc.id },
      include: { executions: true },
    });
    expect(after.title).toBe("Reworded");
    expect(after.status).toBe("FAILED");
    expect(after.lastExecutedAt).not.toBeNull();
    expect(after.executions).toHaveLength(1);
  });

  it("adds a platform the sheet uses that the project lacked", async () => {
    const { project } = await createProject();

    const summary = await importTestCases(project.id, file([["A-1", "Users", "List users", "API"]]));

    expect(summary.platformsAdded).toEqual(["API"]);
    const updated = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(updated.platforms).toEqual(expect.arrayContaining(["WEB", "API"]));
  });

  it("writes nothing when the sheet is rejected", async () => {
    const { project } = await createProject();

    await expect(
      importTestCases(project.id, {
        buffer: workbook({ Cases: [["foo", "bar"]] }),
        fileName: "bad.xlsx",
      }),
    ).rejects.toThrow();
    expect(await prisma.testCase.count()).toBe(0);
  });
});
