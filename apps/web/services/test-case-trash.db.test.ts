import { beforeEach, describe, expect, it } from "vitest";

import { includingTrash, prisma } from "@/lib/prisma";
import { testCaseQuerySchema } from "@/lib/validations";
import { createProject, createTestCase, createUser, resetDatabase } from "@/test/db";
import { workbook } from "@/test/workbook";

import { getProjectDashboard, getRecentActivity } from "./dashboard.service";
import { recordExecution } from "./execution.service";
import { importTestCases } from "./import.service";
import { listModules } from "./module.service";
import {
  countTrash,
  createTestCase as createTestCaseFromForm,
  deleteTestCase,
  deleteTestCases,
  getTestCase,
  listTestCases,
  listTrash,
  purgeTestCases,
  restoreTestCases,
  updateTestCase,
} from "./test-case.service";

beforeEach(resetDatabase);

/** A project with two cases, TC-1 failed once; TC-1 then deleted by a QA. */
async function seed() {
  const { project, module } = await createProject();
  const qa = await createUser("QA");
  const one = await createTestCase(project.id, module.id, "TC-1", "Sign in");
  const two = await createTestCase(project.id, module.id, "TC-2", "Sign out");
  await recordExecution(one.id, qa.id, { status: "FAILED" });
  await deleteTestCase(one.id, qa.id);
  return { project, module, qa, one, two };
}

const listIds = async (projectId: string) =>
  (await listTestCases(projectId, testCaseQuerySchema.parse({}))).items.map((c) => c.tcId);

describe("deleting a test case", () => {
  it("moves it to the Trash: gone from the list, its history kept", async () => {
    const { project, qa, one } = await seed();

    expect(await listIds(project.id)).toEqual(["TC-2"]);
    await expect(getTestCase(one.id)).rejects.toThrow();
    expect(await prisma.testExecution.count({ where: { testCaseId: one.id } })).toBe(1);

    expect(await countTrash(project.id)).toBe(1);
    expect(await listTrash(project.id)).toMatchObject([
      { id: one.id, tcId: "TC-1", status: "FAILED", executions: 1, deletedByName: qa.name },
    ]);
  });

  it("bulk delete is scoped to the project", async () => {
    const { project, two, qa } = await seed();
    const other = await createProject("Other");
    const outsider = await createTestCase(other.project.id, other.module.id, "TC-9");

    const result = await deleteTestCases(project.id, [two.id, outsider.id], qa.id);

    expect(result).toEqual({ deleted: 1, missing: 1 });
    expect(await listIds(other.project.id)).toEqual(["TC-9"]);
  });

  it("leaves it out of the dashboard, activity and module counts", async () => {
    const { project, module } = await seed();

    const dashboard = await getProjectDashboard(project.id);
    expect(dashboard.stats.total).toBe(1);
    expect(dashboard.stats.failed).toBe(0);
    expect(dashboard.daily.reduce((sum, day) => sum + day.total, 0)).toBe(0);

    expect(await getRecentActivity(8, [project.id])).toEqual([]);
    expect(await getRecentActivity(8)).toEqual([]);

    const [mod] = await listModules(project.id);
    expect(mod).toMatchObject({ id: module.id, _count: { testCases: 1 } });
  });
});

describe("restoring", () => {
  it("brings the case back with its history", async () => {
    const { project, one } = await seed();

    expect(await restoreTestCases(project.id, [one.id])).toEqual({ restored: 1 });

    expect(await listIds(project.id)).toEqual(["TC-1", "TC-2"]);
    expect((await getTestCase(one.id)).status).toBe("FAILED");
    expect(await countTrash(project.id)).toBe(0);
    const dashboard = await getProjectDashboard(project.id);
    expect(dashboard.stats.failed).toBe(1);
  });

  it("only restores cases that are in this project's Trash", async () => {
    const { project, two } = await seed();
    await expect(restoreTestCases(project.id, [two.id])).rejects.toThrow();
  });
});

describe("TC IDs of cases in the Trash", () => {
  it("stay taken, with a message that says where the case is", async () => {
    const { project, module, two } = await seed();
    const form = { moduleId: module.id, tcId: "tc-1", title: "Again" };

    await expect(createTestCaseFromForm(project.id, form)).rejects.toThrow(/in the Trash/);
    await expect(updateTestCase(two.id, form)).rejects.toThrow(/in the Trash/);
  });

  it("are skipped by an import that skips existing cases", async () => {
    const { project, one } = await seed();
    const file = {
      buffer: workbook({ Cases: [["TC ID", "Module", "Test Case"], ["TC-1", "Login", "From the sheet"]] }),
      fileName: "cases.xlsx",
    };

    const summary = await importTestCases(project.id, file, "skip");

    expect(summary).toMatchObject({ created: 0, updated: 0 });
    expect(summary.errors[0]?.reason).toMatch(/in the Trash/);
    expect(await countTrash(project.id)).toBe(1);
    const kept = await prisma.testCase.findUniqueOrThrow({ where: { id: one.id, ...includingTrash } });
    expect(kept.title).toBe("Sign in");
  });

  it("come back when an import updates them", async () => {
    const { project, one } = await seed();
    const file = {
      buffer: workbook({ Cases: [["TC ID", "Module", "Test Case"], ["TC-1", "Login", "From the sheet"]] }),
      fileName: "cases.xlsx",
    };

    const summary = await importTestCases(project.id, file, "update");

    expect(summary).toMatchObject({ created: 0, updated: 1 });
    const restored = await getTestCase(one.id);
    expect(restored).toMatchObject({ title: "From the sheet", status: "FAILED" });
    expect(await countTrash(project.id)).toBe(0);
  });
});

describe("deleting forever", () => {
  it("removes only cases in the Trash, with their history", async () => {
    const { project, one, two } = await seed();

    // TC-2 is not in the Trash: naming it does nothing.
    expect(await purgeTestCases(project.id, [one.id, two.id])).toEqual({ deleted: 1 });

    expect(await prisma.testCase.count({ where: { id: one.id, ...includingTrash } })).toBe(0);
    expect(await prisma.testExecution.count({ where: { testCaseId: one.id } })).toBe(0);
    expect(await listIds(project.id)).toEqual(["TC-2"]);
  });

  it("empties the whole Trash of one project only", async () => {
    const { project, two, qa } = await seed();
    await deleteTestCase(two.id, qa.id);
    const other = await createProject("Other");
    const theirs = await createTestCase(other.project.id, other.module.id, "TC-9");
    await deleteTestCase(theirs.id, qa.id);

    expect(await purgeTestCases(project.id)).toEqual({ deleted: 2 });

    expect(await countTrash(project.id)).toBe(0);
    expect(await countTrash(other.project.id)).toBe(1);
  });

  it("frees the TC ID", async () => {
    const { project, module, one } = await seed();
    await purgeTestCases(project.id, [one.id]);

    const created = await createTestCaseFromForm(project.id, {
      moduleId: module.id,
      tcId: "TC-1",
      title: "New",
    });
    expect(created.tcId).toBe("TC-1");
  });
});
