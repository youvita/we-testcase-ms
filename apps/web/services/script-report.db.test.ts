import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { createProject, createTestCase, resetDatabase } from "@/test/db";
import type { ScriptWritingResult } from "@wetestcase/dto";

import { saveScriptAndReport } from "./ai-scripts.service";

beforeEach(resetDatabase);

const CODE = `await page.goto("/");`;

/** A finished "write with AI" job whose last try passed on SIT. */
async function setUp(outcome: ScriptWritingResult["outcome"] = "passed") {
  const { project, module, owner } = await createProject();
  const testCase = await createTestCase(project.id, module.id, "TC-1");
  const run = await prisma.testRun.create({
    data: {
      projectId: project.id,
      environmentName: "SIT",
      createdById: owner.id,
      status: "PASSED",
      purpose: "SCRIPT_CHECK",
      recordResults: false,
      code: "K7Q3P",
      items: { create: { position: 0, code: CODE, status: "PASSED", testCaseId: testCase.id } },
    },
  });
  const result: ScriptWritingResult = {
    testCaseId: testCase.id,
    outcome,
    code: CODE,
    notes: "",
    attempts: [{ code: CODE, runId: run.id, status: outcome === "passed" ? "PASSED" : "FAILED", error: null }],
  };
  const job = await prisma.aiJob.create({
    data: {
      projectId: project.id,
      kind: "WRITE_SCRIPT",
      status: "SUCCEEDED",
      createdById: owner.id,
      input: { testCaseId: testCase.id },
      result,
    },
  });
  const user = { id: owner.id, name: owner.name } as SessionUser;
  return { testCase, run, job, user };
}

describe("Save script & report result", () => {
  it("saves the passing script and records its pass without running it again", async () => {
    const { testCase, run, job, user } = await setUp();

    const updated = await saveScriptAndReport(testCase.id, job.id, user);

    const script = await prisma.automationScript.findUniqueOrThrow({ where: { testCaseId: testCase.id } });
    expect(script.code).toBe(CODE);
    expect(script.verifiedAt).not.toBeNull();

    const executions = await prisma.testExecution.findMany({ where: { testCaseId: testCase.id } });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({ status: "PASSED", environmentName: "SIT" });
    expect(executions[0]!.comment).toContain("Script check #K7Q3P on SIT");
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: testCase.id } })).status).toBe("PASSED");

    const item = await prisma.testRunItem.findFirstOrThrow({ where: { runId: run.id } });
    expect(item.executionId).toBe(executions[0]!.id);
    // No new run was queued.
    expect(await prisma.testRun.count()).toBe(1);
    expect((updated.result as ScriptWritingResult).recordedExecutionId).toBe(executions[0]!.id);

    // Once only.
    await expect(saveScriptAndReport(testCase.id, job.id, user)).rejects.toThrow(/already reported/);
  });

  it("is refused for a script that did not pass", async () => {
    const { testCase, job, user } = await setUp("product_bug");
    await expect(saveScriptAndReport(testCase.id, job.id, user)).rejects.toThrow(/Only a script that passed/);
    expect(await prisma.testExecution.count()).toBe(0);
    expect(await prisma.automationScript.count()).toBe(0);
  });
});
