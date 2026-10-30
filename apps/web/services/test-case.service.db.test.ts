import { beforeEach, describe, expect, it } from "vitest";

import { testCaseQuerySchema } from "@/lib/validations";
import { createProject, createTestCase, resetDatabase } from "@/test/db";

import {
  createTestCase as createTestCaseFromForm,
  getTestCaseNeighbours,
  listTestCases,
  updateTestCase,
} from "./test-case.service";

beforeEach(resetDatabase);

/** Inserted out of order, and without zero-padding, on purpose. */
const IDS = ["TC-10", "TC-2", "TC-1", "TC-100", "TC-20", "TC-3"];
const NATURAL = ["TC-1", "TC-2", "TC-3", "TC-10", "TC-20", "TC-100"];

async function seed() {
  const { project, module } = await createProject();
  const cases = new Map<string, string>();
  for (const tcId of IDS) {
    const tc = await createTestCase(project.id, module.id, tcId);
    cases.set(tcId, tc.id);
  }
  return { projectId: project.id, cases };
}

describe("TC ID ordering", () => {
  it("lists TC IDs in natural order, not character order", async () => {
    const { projectId } = await seed();

    const page = await listTestCases(projectId, testCaseQuerySchema.parse({}));

    expect(page.items.map((i) => i.tcId)).toEqual(NATURAL);
  });

  it("reverses naturally when sorted descending", async () => {
    const { projectId } = await seed();

    const page = await listTestCases(projectId, testCaseQuerySchema.parse({ order: "desc" }));

    expect(page.items.map((i) => i.tcId)).toEqual([...NATURAL].reverse());
  });

  it("steps Previous/Next in the same natural order", async () => {
    const { projectId, cases } = await seed();

    const { prevId, nextId } = await getTestCaseNeighbours(projectId, "TC-3");

    expect(prevId).toBe(cases.get("TC-2"));
    expect(nextId).toBe(cases.get("TC-10"));
  });
});

describe("TC ID uniqueness", () => {
  function form(moduleId: string, tcId: string) {
    return { moduleId, tcId, title: `Case ${tcId}` };
  }

  it("refuses a new case whose TC ID differs only in capitalisation", async () => {
    const { project, module } = await createProject();
    await createTestCase(project.id, module.id, "TC-1");

    await expect(createTestCaseFromForm(project.id, form(module.id, "tc-1"))).rejects.toThrow(
      /already used/,
    );
  });

  it("refuses renaming a case onto another's TC ID in different capitals", async () => {
    const { project, module } = await createProject();
    await createTestCase(project.id, module.id, "TC-1");
    const other = await createTestCase(project.id, module.id, "TC-2");

    await expect(updateTestCase(other.id, form(module.id, "tc-1"))).rejects.toThrow(
      /already used/,
    );
  });

  it("lets a case change the capitalisation of its own TC ID", async () => {
    const { project, module } = await createProject();
    const tc = await createTestCase(project.id, module.id, "tc-1");

    const updated = await updateTestCase(tc.id, form(module.id, "TC-1"));

    expect(updated.tcId).toBe("TC-1");
  });
});
