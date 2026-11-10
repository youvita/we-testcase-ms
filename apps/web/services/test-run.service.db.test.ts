import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, createTestCase, resetDatabase } from "@/test/db";

import { getLastFinishedRun, listTestRunsPage, reportItemResult } from "./test-run.service";

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

describe("a failed automated case in its history", () => {
  const code = [
    'await page.goto("/login");',
    'await page.getByRole("button", { name: "Log in" }).click();',
    "await expect(page).not.toHaveURL(/login/);",
    "",
    "// Step 1: Save the customer",
    'await page.getByRole("button", { name: "Save" }).click();',
    "await expect(page.getByText('Saved')).toBeVisible();",
  ].join("\n");

  async function runOne() {
    const { project, module, owner } = await createProject();
    const testCase = await createTestCase(project.id, module.id, "TC-1");
    const run = await prisma.testRun.create({
      data: { projectId: project.id, number: 7, environmentName: "UAT", createdById: owner.id, status: "RUNNING" },
    });
    const item = await prisma.testRunItem.create({
      data: { runId: run.id, testCaseId: testCase.id, position: 0, code },
    });
    return { testCase, item };
  }
  const latest = (testCaseId: string) =>
    prisma.testExecution.findFirstOrThrow({ where: { testCaseId }, orderBy: { executedAt: "desc" } });

  it("is blocked, in plain words, when it fails before its first step", async () => {
    const { testCase, item } = await runOne();
    await reportItemResult(
      item.id,
      {
        status: "FAILED",
        error: [
          "Error: expect(page).not.toHaveURL(expected) failed",
          "",
          "Expected pattern: not /login/",
          'Received string: "https://uat.example.com/login"',
          "Timeout: 5000ms",
          "",
          "> 3 | await expect(page).not.toHaveURL(/login/);",
          "    at script:3:24",
        ].join("\n"),
      },
      [],
    );

    const execution = await latest(testCase.id);
    expect(execution.status).toBe("BLOCKED");
    expect(execution.actualResult).toBe(
      "Could not sign in: after clicking the “Log in” button, the page stayed on https://uat.example.com/login.",
    );
    // The run keeps the whole error.
    expect((await prisma.testRunItem.findUniqueOrThrow({ where: { id: item.id } })).error).toContain("Expected pattern");
  });

  it("is failed, at its step, when a step fails", async () => {
    const { testCase, item } = await runOne();
    await reportItemResult(
      item.id,
      {
        status: "FAILED",
        error:
          "Error: expect(locator).toBeVisible() failed\n\nLocator: getByText('Saved')\nExpected: visible\nTimeout: 5000ms\n\n> 7 | await expect(page.getByText('Saved')).toBeVisible();",
      },
      [],
    );

    const execution = await latest(testCase.id);
    expect(execution.status).toBe("FAILED");
    expect(execution.actualResult).toMatch(/^At step 1 \(Save the customer\): the text “Saved” did not appear within 5 s\./);
  });
});
