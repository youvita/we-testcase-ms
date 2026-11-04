import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, resetDatabase } from "@/test/db";

import { getLastFinishedRun, listTestRunsPage } from "./test-run.service";

beforeEach(resetDatabase);

async function runs(count: number) {
  const { project, owner } = await createProject();
  for (let number = 1; number <= count; number += 1) {
    await prisma.testRun.create({
      data: {
        projectId: project.id,
        number,
        environmentName: "UAT",
        createdById: owner.id,
        status: "PASSED",
        finishedAt: new Date(),
      },
    });
  }
  return { project, owner };
}

describe("listTestRunsPage", () => {
  it("pages the project's runs, newest first", async () => {
    const { project } = await runs(12);

    const first = await listTestRunsPage(project.id, { page: 1, pageSize: 5 });
    const last = await listTestRunsPage(project.id, { page: 3, pageSize: 5 });

    expect(first).toMatchObject({ page: 1, total: 12, totalPages: 3 });
    expect(first.items.map((run) => run.number)).toEqual([12, 11, 10, 9, 8]);
    expect(last.items.map((run) => run.number)).toEqual([2, 1]);
  });

  it("shows the last page for a page past the end, and leaves script checks out", async () => {
    const { project, owner } = await runs(3);
    await prisma.testRun.create({
      data: { projectId: project.id, purpose: "SCRIPT_CHECK", environmentName: "UAT", createdById: owner.id },
    });

    const page = await listTestRunsPage(project.id, { page: 9, pageSize: 2 });

    expect(page).toMatchObject({ page: 2, total: 3, totalPages: 2 });
    expect(page.items.map((run) => run.number)).toEqual([1]);
  });
});

describe("getLastFinishedRun", () => {
  it("is the newest finished run that was not cancelled", async () => {
    const { project, owner } = await runs(2);
    await prisma.testRun.createMany({
      data: [
        { projectId: project.id, number: 3, environmentName: "UAT", createdById: owner.id, status: "CANCELLED", finishedAt: new Date() },
        { projectId: project.id, number: 4, environmentName: "UAT", createdById: owner.id, status: "RUNNING" },
      ],
    });

    expect((await getLastFinishedRun(project.id))?.number).toBe(2);
  });
});
