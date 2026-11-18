import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, createTestCase, createUser, resetDatabase } from "@/test/db";

import { deleteExecution, recordExecution, updateExecution } from "./execution.service";

beforeEach(resetDatabase);

async function setup() {
  const { project, module } = await createProject();
  const tester = await createUser("QA");
  const tc = await createTestCase(project.id, module.id, "TC-1");
  return { tc, tester };
}

describe("recordExecution", () => {
  it("appends to the history and copies the status onto the case", async () => {
    const { tc, tester } = await setup();

    await recordExecution(tc.id, tester.id, { status: "FAILED" });
    await recordExecution(tc.id, tester.id, { status: "PASSED" });

    const after = await prisma.testCase.findUniqueOrThrow({
      where: { id: tc.id },
      include: { executions: { orderBy: { executedAt: "asc" } } },
    });
    expect(after.executions.map((e) => e.status)).toEqual(["FAILED", "PASSED"]);
    expect(after.status).toBe("PASSED");
    expect(after.lastExecutedAt).not.toBeNull();
  });

  it("clears the last-run time when a case goes back to Not Run", async () => {
    const { tc, tester } = await setup();

    await recordExecution(tc.id, tester.id, { status: "PASSED" });
    await recordExecution(tc.id, tester.id, { status: "NOT_RUN" });

    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } });
    expect(after.status).toBe("NOT_RUN");
    expect(after.lastExecutedAt).toBeNull();
  });

  it("resets the developer's fix status, since the retest answered it", async () => {
    const { tc, tester } = await setup();
    const developer = await createUser("DEVELOPER");
    await prisma.testCase.update({
      where: { id: tc.id },
      data: { fixStatus: "FIXED", fixStatusAt: new Date(), fixStatusById: developer.id },
    });

    await recordExecution(tc.id, tester.id, { status: "PASSED" });

    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } });
    expect(after).toMatchObject({ fixStatus: "NONE", fixStatusAt: null, fixStatusById: null });
  });
});

describe("updateExecution", () => {
  it("editing an older result leaves the case on the newest one", async () => {
    const { tc, tester } = await setup();
    const older = await recordExecution(tc.id, tester.id, { status: "FAILED" });
    await recordExecution(tc.id, tester.id, { status: "PASSED" });

    await updateExecution(older.id, { id: tester.id, role: "QA" }, { status: "BLOCKED" });

    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } });
    expect(after.status).toBe("PASSED");
    const edited = await prisma.testExecution.findUniqueOrThrow({ where: { id: older.id } });
    expect(edited).toMatchObject({ status: "BLOCKED", editedById: tester.id });
    expect(edited.editedAt).not.toBeNull();
  });

  it("lets only the tester or an Admin edit a result", async () => {
    const { tc, tester } = await setup();
    const other = await createUser("QA");
    const admin = await createUser("ADMIN");
    const execution = await recordExecution(tc.id, tester.id, { status: "FAILED" });

    await expect(
      updateExecution(execution.id, { id: other.id, role: "QA" }, { status: "PASSED" }),
    ).rejects.toThrow(/only edit results you recorded/);

    await updateExecution(execution.id, { id: admin.id, role: "ADMIN" }, { status: "PASSED" });
    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } });
    expect(after.status).toBe("PASSED");
  });
});

describe("deleteExecution", () => {
  const qa = (user: { id: string }) => ({ id: user.id, role: "QA" as const });

  it("removes a result and the case reads from the one before it", async () => {
    const { tc, tester } = await setup();
    await recordExecution(tc.id, tester.id, { status: "PASSED" });
    const failed = await recordExecution(tc.id, tester.id, { status: "FAILED" });

    await deleteExecution(failed.id, qa(tester));
    const after = await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id }, include: { executions: true } });
    expect(after.executions.map((e) => e.status)).toEqual(["PASSED"]);
    expect(after.status).toBe("PASSED");

    // The last one gone: not run.
    await deleteExecution(after.executions[0]!.id, qa(tester));
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: tc.id } })).status).toBe("NOT_RUN");
  });

  it("is only for its recorder or an admin", async () => {
    const { tc, tester } = await setup();
    const other = await createUser("QA");
    const result = await recordExecution(tc.id, tester.id, { status: "FAILED" });
    await expect(deleteExecution(result.id, qa(other))).rejects.toThrow(/results you recorded/);
    await deleteExecution(result.id, { id: other.id, role: "ADMIN" });
  });

  it("keeps the latest result once a developer is working from it", async () => {
    const { tc, tester } = await setup();
    const older = await recordExecution(tc.id, tester.id, { status: "FAILED" });
    const latest = await recordExecution(tc.id, tester.id, { status: "FAILED" });
    await prisma.testCase.update({ where: { id: tc.id }, data: { fixStatus: "INVESTIGATING" } });

    await expect(deleteExecution(latest.id, qa(tester))).rejects.toThrow(/developer is already working/);
    // An older one is not what they are working from.
    await deleteExecution(older.id, qa(tester));
  });
});
