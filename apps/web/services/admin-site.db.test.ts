import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, createTestCase, resetDatabase } from "@/test/db";

import { claimNextRun, createTestRun } from "./test-run.service";

beforeEach(resetDatabase);

/** A Web case on each site, both automated, and a sign-in case on the Web site. */
async function setUp(environment: { adminBaseUrl?: string } = { adminBaseUrl: "https://admin.example.test" }) {
  const { project, module, owner } = await createProject();
  const env = await prisma.runEnvironment.create({
    data: { projectId: project.id, name: "SIT", webBaseUrl: "https://web.example.test", ...environment },
  });
  const automated = async (tcId: string, site: "WEB" | "ADMIN") => {
    const testCase = await createTestCase(project.id, module.id, tcId);
    await prisma.testCase.update({ where: { id: testCase.id }, data: { site } });
    await prisma.automationScript.create({ data: { testCaseId: testCase.id, code: `// ${tcId}`, updatedById: owner.id } });
    return testCase;
  };
  const signIn = await automated("TC-LOGIN", "WEB");
  const web = await automated("TC-WEB", "WEB");
  const admin = await automated("TC-ADMIN", "ADMIN");
  return { project, owner, env, signIn, web, admin };
}

describe("Web cases on the Admin site", () => {
  it("run on the Admin base URL, and only Web-site cases are opened with a Web sign-in", async () => {
    const { project, owner, env, signIn, web, admin } = await setUp();

    await createTestRun(project.id, owner.id, {
      environmentId: env.id,
      scope: "cases",
      testCaseIds: [web.id, admin.id],
      setupTestCaseId: signIn.id,
    });
    const job = await claimNextRun("test");

    expect(job?.environment.adminBaseUrl).toBe("https://admin.example.test");
    const byTcId = new Map(job!.items.map((item) => [item.tcId, item]));
    expect(byTcId.get("TC-WEB")).toMatchObject({ site: "WEB" });
    expect(byTcId.get("TC-WEB")!.code).toContain("Sign in first: TC-LOGIN");
    expect(byTcId.get("TC-ADMIN")).toMatchObject({ site: "ADMIN", code: "// TC-ADMIN" });
  });

  it("cannot run where the environment has no Admin base URL", async () => {
    const { project, owner, env, admin } = await setUp({});

    await expect(
      createTestRun(project.id, owner.id, { environmentId: env.id, scope: "cases", testCaseIds: [admin.id] }),
    ).rejects.toThrow(/SIT has no Admin base URL, and 1 Admin case is selected/);
  });
});
