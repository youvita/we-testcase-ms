import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { open, seal } from "@/lib/secret-box";
import { createProject, createTestCase, resetDatabase } from "@/test/db";
import type { ProjectCopyRequest } from "@wetestcase/dto";

import { copyToProject, previewCopy } from "./project-copy.service";

// Sealing environment variables needs a key; .env is not loaded in tests.
process.env.BETTER_AUTH_SECRET ||= "test-secret";

beforeEach(resetDatabase);

function request(
  targetProjectId: string,
  overrides: Partial<ProjectCopyRequest> = {},
): ProjectCopyRequest {
  return {
    targetProjectId,
    scope: { kind: "project" },
    mode: "skip",
    includeEnvironments: true,
    includeRequirements: true,
    ...overrides,
  };
}

async function twoProjects() {
  const source = await createProject("Source");
  const target = await createProject("Target");
  return { source, target };
}

async function addScript(testCaseId: string, userId: string, code: string, verified = true) {
  await prisma.automationScript.create({
    data: { testCaseId, code, updatedById: userId, verifiedAt: verified ? new Date() : null },
  });
}

describe("copyToProject", () => {
  it("copies cases, modules and scripts, starting fresh", async () => {
    const { source, target } = await twoProjects();
    const checkout = await prisma.module.create({
      data: { projectId: source.project.id, name: "Checkout", position: 1 },
    });
    const login = await createTestCase(source.project.id, source.module.id, "TC-1", "Sign in");
    await prisma.testCase.update({
      where: { id: login.id },
      data: { status: "FAILED", subModule: "Form", platform: "API", priority: "HIGH" },
    });
    await addScript(login.id, source.owner.id, "await page.goto('/');");
    await createTestCase(source.project.id, checkout.id, "TC-2", "Pay");

    const summary = await copyToProject(source.project.id, request(target.project.id), source.owner.id);

    expect(summary).toMatchObject({
      created: 2,
      updated: 0,
      scriptsCopied: 1,
      modulesCreated: ["Checkout"],
      platformsAdded: ["API"],
    });
    const copied = await prisma.testCase.findMany({
      where: { projectId: target.project.id },
      include: { module: true, script: true },
      orderBy: { tcId: "asc" },
    });
    expect(copied.map((c) => [c.tcId, c.module.name, c.subModule])).toEqual([
      ["TC-1", "Login", "Form"],
      ["TC-2", "Checkout", null],
    ]);
    expect(copied[0]).toMatchObject({ status: "NOT_RUN", platform: "API", priority: "HIGH" });
    expect(copied[0]!.script).toMatchObject({ code: "await page.goto('/');", verifiedAt: null });

    const targetProject = await prisma.project.findUniqueOrThrow({ where: { id: target.project.id } });
    expect(targetProject.platforms).toEqual(["WEB", "API"]);
    // The source is left exactly as it was.
    expect(await prisma.testCase.count({ where: { projectId: source.project.id } })).toBe(2);
  });

  it("copies only the selected cases, ignoring ids from other projects", async () => {
    const { source, target } = await twoProjects();
    const one = await createTestCase(source.project.id, source.module.id, "TC-1");
    await createTestCase(source.project.id, source.module.id, "TC-2");
    const elsewhere = await createTestCase(target.project.id, target.module.id, "TC-9");

    const summary = await copyToProject(
      source.project.id,
      request(target.project.id, { scope: { kind: "cases", ids: [one.id, elsewhere.id] } }),
      source.owner.id,
    );

    expect(summary.created).toBe(1);
    const tcIds = await prisma.testCase.findMany({
      where: { projectId: target.project.id },
      select: { tcId: true },
      orderBy: { tcId: "asc" },
    });
    expect(tcIds.map((c) => c.tcId)).toEqual(["TC-1", "TC-9"]);
  });

  it("copies one module", async () => {
    const { source, target } = await twoProjects();
    const other = await prisma.module.create({ data: { projectId: source.project.id, name: "Other" } });
    await createTestCase(source.project.id, source.module.id, "TC-1");
    await createTestCase(source.project.id, other.id, "TC-2");

    const summary = await copyToProject(
      source.project.id,
      request(target.project.id, { scope: { kind: "module", moduleId: other.id } }),
      source.owner.id,
    );

    expect(summary).toMatchObject({ created: 1, modulesCreated: ["Other"] });
  });

  it("skips TC IDs the target already has, case-insensitively", async () => {
    const { source, target } = await twoProjects();
    await createTestCase(source.project.id, source.module.id, "TC-1", "From source");
    await createTestCase(target.project.id, target.module.id, "tc-1", "Target's own");

    const summary = await copyToProject(source.project.id, request(target.project.id), source.owner.id);

    expect(summary).toMatchObject({ created: 0, updated: 0, skipped: ["TC-1"] });
    const kept = await prisma.testCase.findFirstOrThrow({ where: { projectId: target.project.id } });
    expect(kept.title).toBe("Target's own");
  });

  it("overwrites details but never results, and keeps an unchanged script verified", async () => {
    const { source, target } = await twoProjects();
    const a = await createTestCase(source.project.id, source.module.id, "TC-1", "New title");
    const b = await createTestCase(source.project.id, source.module.id, "TC-2", "New title");
    await addScript(a.id, source.owner.id, "same");
    await addScript(b.id, source.owner.id, "changed");

    const ta = await createTestCase(target.project.id, target.module.id, "TC-1", "Old");
    const tb = await createTestCase(target.project.id, target.module.id, "TC-2", "Old");
    await prisma.testCase.updateMany({
      where: { projectId: target.project.id },
      data: { status: "PASSED" },
    });
    await addScript(ta.id, target.owner.id, "same");
    await addScript(tb.id, target.owner.id, "original");

    const summary = await copyToProject(
      source.project.id,
      request(target.project.id, { mode: "overwrite" }),
      source.owner.id,
    );

    expect(summary).toMatchObject({ created: 0, updated: 2 });
    const after = await prisma.testCase.findMany({
      where: { projectId: target.project.id },
      include: { script: true },
      orderBy: { tcId: "asc" },
    });
    expect(after.map((c) => [c.title, c.status])).toEqual([
      ["New title", "PASSED"],
      ["New title", "PASSED"],
    ]);
    expect(after[0]!.script!.verifiedAt).not.toBeNull();
    expect(after[1]!.script).toMatchObject({ code: "changed", verifiedAt: null });
  });

  it("copies run environments with secret values blanked, never replacing the target's", async () => {
    const { source, target } = await twoProjects();
    const variables = [
      { key: "USER", value: "qa@example.test", secret: false },
      { key: "PASSWORD", value: "hunter2", secret: true },
    ];
    await prisma.runEnvironment.createMany({
      data: [
        { projectId: source.project.id, name: "SIT", webBaseUrl: "https://sit.test", variablesSealed: seal(JSON.stringify(variables)) },
        { projectId: source.project.id, name: "UAT", webBaseUrl: "https://uat.source" },
        { projectId: target.project.id, name: "UAT", webBaseUrl: "https://uat.target" },
      ],
    });
    await createTestCase(source.project.id, source.module.id, "TC-1");

    const summary = await copyToProject(source.project.id, request(target.project.id), source.owner.id);

    expect(summary.environmentsCreated).toEqual(["SIT"]);
    expect(summary.secretsToFill).toEqual([{ environment: "SIT", keys: ["PASSWORD"] }]);
    const envs = await prisma.runEnvironment.findMany({
      where: { projectId: target.project.id },
      orderBy: { name: "asc" },
    });
    expect(envs.map((e) => [e.name, e.webBaseUrl])).toEqual([
      ["SIT", "https://sit.test"],
      ["UAT", "https://uat.target"],
    ]);
    expect(JSON.parse(open(envs[0]!.variablesSealed!)!)).toEqual([
      { key: "USER", value: "qa@example.test", secret: false },
      { key: "PASSWORD", value: "", secret: true },
    ]);
  });

  it("brings the requirements selected cases verify, and links them, without duplicating on a second copy", async () => {
    const { source, target } = await twoProjects();
    const doc = await prisma.requirementDoc.create({
      data: { projectId: source.project.id, title: "PRD", content: "text", charCount: 4, version: 3, createdById: source.owner.id },
    });
    const [linked, unlinked] = await Promise.all([
      prisma.requirement.create({ data: { docId: doc.id, projectId: source.project.id, code: "FR-1", title: "Sign in" } }),
      prisma.requirement.create({ data: { docId: doc.id, projectId: source.project.id, code: "FR-2", title: "Other" } }),
    ]);
    const tc = await createTestCase(source.project.id, source.module.id, "TC-1");
    await prisma.testCaseRequirement.create({ data: { testCaseId: tc.id, requirementId: linked.id } });
    const selected = request(target.project.id, { scope: { kind: "cases", ids: [tc.id] }, mode: "overwrite" });

    const first = await copyToProject(source.project.id, selected, source.owner.id);
    const second = await copyToProject(source.project.id, selected, source.owner.id);

    expect(first).toMatchObject({ requirementDocsCreated: 1, requirementsCreated: 1, requirementLinks: 1 });
    expect(second).toMatchObject({ requirementDocsCreated: 0, requirementsCreated: 0, requirementLinks: 0 });
    const docs = await prisma.requirementDoc.findMany({
      where: { projectId: target.project.id },
      include: { requirements: { include: { testCases: { include: { testCase: true } } } } },
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]!.version).toBe(1);
    expect(docs[0]!.requirements.map((r) => [r.code, r.testCases.map((l) => l.testCase.tcId)])).toEqual([
      ["FR-1", ["TC-1"]],
    ]);
    expect(unlinked.code).toBe("FR-2");
  });

  it("brings every requirement document on a whole-project copy", async () => {
    const { source, target } = await twoProjects();
    const doc = await prisma.requirementDoc.create({
      data: { projectId: source.project.id, title: "FRD", kind: "FRD", content: "x", charCount: 1, createdById: source.owner.id },
    });
    await prisma.requirement.createMany({
      data: [
        { docId: doc.id, projectId: source.project.id, code: "1.1", title: "A" },
        { docId: doc.id, projectId: source.project.id, code: "1.2", title: "B" },
      ],
    });
    await createTestCase(source.project.id, source.module.id, "TC-1");

    const summary = await copyToProject(source.project.id, request(target.project.id), source.owner.id);

    expect(summary).toMatchObject({ requirementDocsCreated: 1, requirementsCreated: 2, requirementLinks: 0 });
  });

  it("leaves environments and requirements behind when unticked", async () => {
    const { source, target } = await twoProjects();
    await prisma.runEnvironment.create({ data: { projectId: source.project.id, name: "SIT" } });
    await prisma.requirementDoc.create({
      data: { projectId: source.project.id, title: "PRD", content: "x", charCount: 1, createdById: source.owner.id },
    });
    await createTestCase(source.project.id, source.module.id, "TC-1");

    await copyToProject(
      source.project.id,
      request(target.project.id, { includeEnvironments: false, includeRequirements: false }),
      source.owner.id,
    );

    expect(await prisma.runEnvironment.count({ where: { projectId: target.project.id } })).toBe(0);
    expect(await prisma.requirementDoc.count({ where: { projectId: target.project.id } })).toBe(0);
  });

  it("refuses to copy a project into itself", async () => {
    const { source } = await twoProjects();
    await createTestCase(source.project.id, source.module.id, "TC-1");

    await expect(
      copyToProject(source.project.id, request(source.project.id), source.owner.id),
    ).rejects.toThrow("different project");
  });
});

describe("previewCopy", () => {
  it("reports what the copy then does, without writing", async () => {
    const { source, target } = await twoProjects();
    const tc = await createTestCase(source.project.id, source.module.id, "TC-1");
    await createTestCase(source.project.id, source.module.id, "TC-2");
    await addScript(tc.id, source.owner.id, "code");
    await createTestCase(target.project.id, target.module.id, "TC-2");
    await prisma.runEnvironment.create({ data: { projectId: source.project.id, name: "SIT" } });

    const preview = await previewCopy(source.project.id, request(target.project.id));

    expect(preview).toMatchObject({
      targetProjectName: "Target",
      cases: 2,
      newCases: 1,
      existing: 1,
      scripts: 1,
      newModules: 0,
      newEnvironments: 1,
    });
    expect(await prisma.testCase.count({ where: { projectId: target.project.id } })).toBe(1);

    const summary = await copyToProject(source.project.id, request(target.project.id), source.owner.id);
    expect(summary.created).toBe(preview.newCases);
    expect(summary.skipped).toHaveLength(preview.existing);
  });
});
