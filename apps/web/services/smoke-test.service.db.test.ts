import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, createTestCase, resetDatabase } from "@/test/db";

import { listProjects } from "./project.service";
import { getSmokeTest, runSmokeTest, saveSmokeTest } from "./smoke-test.service";

beforeEach(resetDatabase);

/** A project with an environment and automated Web cases A, B and C. */
async function setUp() {
  const { project, module, owner } = await createProject();
  const environment = await prisma.runEnvironment.create({
    data: { projectId: project.id, name: "UAT", webBaseUrl: "https://uat.example.com" },
  });
  const [a, b, c] = await Promise.all(
    ["TC-A", "TC-B", "TC-C"].map((tcId) => createTestCase(project.id, module.id, tcId)),
  );
  for (const testCase of [a!, b!, c!]) {
    await prisma.automationScript.create({
      data: { testCaseId: testCase.id, code: `// ${testCase.tcId}`, updatedById: owner.id },
    });
  }
  return { project, module, owner, environment, a: a!, b: b!, c: c! };
}

describe("saveSmokeTest", () => {
  it("keeps the cases in the order given, and replaces the old list", async () => {
    const { project, a, b, c } = await setUp();

    await saveSmokeTest(project.id, { testCaseIds: [a.id, b.id], signInTestCaseId: null });
    const saved = await saveSmokeTest(project.id, { testCaseIds: [c.id, a.id], signInTestCaseId: a.id });

    expect(saved.cases.map((x) => x.tcId)).toEqual(["TC-C", "TC-A"]);
    expect(saved.signInTestCaseId).toBe(a.id);
    expect(await prisma.testCase.findUnique({ where: { id: b.id } })).toMatchObject({ smokePosition: null });
  });

  it("refuses another project's case", async () => {
    const { project } = await setUp();
    const other = await createProject("Other");
    const stranger = await createTestCase(other.project.id, other.module.id, "TC-X");

    await expect(
      saveSmokeTest(project.id, { testCaseIds: [stranger.id], signInTestCaseId: null }),
    ).rejects.toThrow(/Only this project's/);
  });

  it("refuses a sign-in case without a script", async () => {
    const { project, module } = await setUp();
    const manual = await createTestCase(project.id, module.id, "TC-M");

    await expect(
      saveSmokeTest(project.id, { testCaseIds: [], signInTestCaseId: manual.id }),
    ).rejects.toThrow(/sign-in case/);
  });
});

describe("runSmokeTest", () => {
  it("runs the smoke cases in order, one at a time, without recording results", async () => {
    const { project, owner, a, b, c } = await setUp();
    await saveSmokeTest(project.id, { testCaseIds: [c.id, a.id, b.id], signInTestCaseId: a.id });

    const run = await runSmokeTest(project.id, owner.id);

    expect(run).toMatchObject({ smoke: true, recordResults: false, inOrder: true, signInOnce: true, total: 3 });
    const items = await prisma.testRunItem.findMany({
      where: { runId: run.id },
      orderBy: { position: "asc" },
      select: { testCase: { select: { tcId: true } } },
    });
    expect(items.map((item) => item.testCase?.tcId)).toEqual(["TC-C", "TC-A", "TC-B"]);
  });

  it("leaves out a case whose script was removed", async () => {
    const { project, owner, a, b } = await setUp();
    await saveSmokeTest(project.id, { testCaseIds: [a.id, b.id], signInTestCaseId: null });
    await prisma.automationScript.delete({ where: { testCaseId: a.id } });

    expect((await getSmokeTest(project.id)).cases.map((x) => x.hasScript)).toEqual([false, true]);
    expect(await runSmokeTest(project.id, owner.id, { withoutSignIn: true })).toMatchObject({ total: 1 });
  });

  it("signs in with the login case in the list when none is chosen", async () => {
    const { project, module, owner, a, b } = await setUp();
    const login = await createTestCase(project.id, module.id, "TC-LOGIN", "Login succeeds with a valid account");
    await prisma.automationScript.create({ data: { testCaseId: login.id, code: "// login", updatedById: owner.id } });
    await saveSmokeTest(project.id, { testCaseIds: [login.id, a.id, b.id], signInTestCaseId: null });

    expect(await runSmokeTest(project.id, owner.id)).toMatchObject({ setupTcId: "TC-LOGIN", signInOnce: true });
  });

  it("runs a list that is only a login case without asking", async () => {
    const { project, module, owner } = await setUp();
    const login = await createTestCase(project.id, module.id, "TC-LOGIN-01", "User logs in with a valid ID and password");
    await prisma.automationScript.create({ data: { testCaseId: login.id, code: "// login", updatedById: owner.id } });
    await saveSmokeTest(project.id, { testCaseIds: [login.id], signInTestCaseId: null });

    expect(await runSmokeTest(project.id, owner.id)).toMatchObject({ total: 1, setupTcId: "TC-LOGIN-01" });
  });

  it("warns, rather than runs, when nothing signs in, until told to run anyway", async () => {
    const { project, owner, a, b } = await setUp();
    await saveSmokeTest(project.id, { testCaseIds: [a.id, b.id], signInTestCaseId: null });

    await expect(runSmokeTest(project.id, owner.id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/2 Web cases start signed out/),
    });
    expect(await runSmokeTest(project.id, owner.id, { withoutSignIn: true })).toMatchObject({
      setupTcId: null,
      total: 2,
    });
  });

  it("does not warn for API cases, which never sign in", async () => {
    const { project, owner, a } = await setUp();
    await prisma.testCase.update({ where: { id: a.id }, data: { platform: "API" } });
    await prisma.runEnvironment.updateMany({ where: { projectId: project.id }, data: { apiBaseUrl: "https://api.example.com" } });
    await saveSmokeTest(project.id, { testCaseIds: [a.id], signInTestCaseId: null });

    expect(await runSmokeTest(project.id, owner.id)).toMatchObject({ total: 1 });
  });

  it("says so when the smoke test is empty", async () => {
    const { project, owner } = await setUp();

    await expect(runSmokeTest(project.id, owner.id)).rejects.toThrow(/no case with an automation script/);
  });

  it("runs against the environment chosen, but only one of the project's", async () => {
    const { project, owner, a } = await setUp();
    const sit = await prisma.runEnvironment.create({
      data: { projectId: project.id, name: "SIT", webBaseUrl: "https://sit.example.com" },
    });
    const other = await createProject("Other");
    const foreign = await prisma.runEnvironment.create({
      data: { projectId: other.project.id, name: "PROD", webBaseUrl: "https://example.com" },
    });
    await saveSmokeTest(project.id, { testCaseIds: [a.id], signInTestCaseId: null });

    expect(await runSmokeTest(project.id, owner.id, { environmentId: sit.id, withoutSignIn: true })).toMatchObject({
      environmentName: "SIT",
    });
    await expect(
      runSmokeTest(project.id, owner.id, { environmentId: foreign.id, withoutSignIn: true }),
    ).rejects.toThrow(/Environment/);
  });

  it("needs a default environment when there are several", async () => {
    const { project, owner, a } = await setUp();
    await prisma.runEnvironment.create({ data: { projectId: project.id, name: "SIT", webBaseUrl: "https://sit.example.com" } });
    await saveSmokeTest(project.id, { testCaseIds: [a.id], signInTestCaseId: null });

    await expect(runSmokeTest(project.id, owner.id)).rejects.toThrow(/default environment/);
  });
});

describe("listProjects", () => {
  it("counts the smoke cases that can run", async () => {
    const { project, a, b } = await setUp();
    await saveSmokeTest(project.id, { testCaseIds: [a.id, b.id], signInTestCaseId: null });
    await prisma.automationScript.delete({ where: { testCaseId: b.id } });

    const [listed] = await listProjects();

    expect(listed).toMatchObject({ id: project.id, smokeCount: 1 });
  });
});
