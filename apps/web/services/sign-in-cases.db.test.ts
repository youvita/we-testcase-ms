import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, createTestCase, resetDatabase } from "@/test/db";

import { listSignInCases } from "./automation-script.service";

beforeEach(resetDatabase);

/** Automated Web cases with these titles, by TC ID. */
async function automated(titles: Record<string, string>) {
  const { project, module, owner } = await createProject();
  const ids: Record<string, string> = {};
  for (const [tcId, title] of Object.entries(titles)) {
    const testCase = await createTestCase(project.id, module.id, tcId, title);
    await prisma.automationScript.create({ data: { testCaseId: testCase.id, code: "//", updatedById: owner.id } });
    ids[tcId] = testCase.id;
  }
  return { project, module, ids };
}

describe("listSignInCases", () => {
  it("offers only the cases that read like a login", async () => {
    const { project } = await automated({
      "TC-1": "Login succeeds with a valid account",
      "TC-2": "New button opens the create customer form",
      "TC-3": "Sign in with SSO",
    });

    expect((await listSignInCases(project.id)).map((c) => c.tcId)).toEqual(["TC-1", "TC-3"]);
  });

  it("offers every automated Web case when none reads like a login", async () => {
    const { project } = await automated({ "TC-1": "Open the home page", "TC-2": "Create a customer" });

    expect((await listSignInCases(project.id)).map((c) => c.tcId)).toEqual(["TC-1", "TC-2"]);
  });

  it("keeps a sign-in case already chosen, whatever its title", async () => {
    const { project, ids } = await automated({ "TC-1": "Login succeeds", "TC-2": "Open the dashboard" });

    expect((await listSignInCases(project.id, ids["TC-2"])).map((c) => c.tcId)).toEqual(["TC-1", "TC-2"]);
  });

  it("still offers only login cases when the login case is the one chosen", async () => {
    const { project, ids } = await automated({ "TC-AI-01": "New button opens the form", "TC-LOGIN": "Login succeeds" });

    expect((await listSignInCases(project.id, ids["TC-LOGIN"])).map((c) => c.tcId)).toEqual(["TC-LOGIN"]);
  });

  it("leaves out manual and API cases", async () => {
    const { project, module } = await automated({ "TC-1": "Login succeeds" });
    await createTestCase(project.id, module.id, "TC-M", "Login by hand");
    await prisma.testCase.update({ where: { projectId_tcId: { projectId: project.id, tcId: "TC-1" } }, data: { platform: "API" } });

    expect(await listSignInCases(project.id)).toEqual([]);
  });
});
