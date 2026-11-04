import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createProject, createTestCase, createUser, resetDatabase } from "@/test/db";
import { projectCreateSchema, projectSchema } from "@/lib/validations";

import { assertEnvironmentName, recordExecution } from "./execution.service";
import { copyToProject } from "./project-copy.service";
import { createProject as createProjectViaService, updateProject } from "./project.service";
import { buildExcelReport, listReportEnvironments } from "./report.service";
import {
  createRunEnvironment,
  duplicateRunEnvironment,
  listRunEnvironments,
  resolveEnvironmentForRunner,
  setDefaultRunEnvironment,
} from "./run-environment.service";

// Sealing environment variables needs a key; .env is not loaded in tests.
process.env.BETTER_AUTH_SECRET ||= "test-secret";

beforeEach(resetDatabase);

const env = (name: string) => ({ name, variables: [] });

describe("default run environment", () => {
  it("is the first environment added, and is listed first", async () => {
    const { project } = await createProject();
    await prisma.project.update({ where: { id: project.id }, data: { environment: "UAT" } });

    const uat = await createRunEnvironment(project.id, env("UAT"));
    const pro = await createRunEnvironment(project.id, env("PRO"));

    expect(uat.isDefault).toBe(true);
    expect(pro.isDefault).toBe(false);
    const stored = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    // The old label is retired once a real default stands in for it.
    expect(stored).toMatchObject({ defaultEnvironmentId: uat.id, environment: null });

    await setDefaultRunEnvironment(pro.id);
    expect((await listRunEnvironments(project.id)).map((e) => [e.name, e.isDefault])).toEqual([
      ["PRO", true],
      ["UAT", false],
    ]);
  });

  it("can only be set to one of the project's own environments", async () => {
    const { project } = await createProject("Mine");
    const { project: other } = await createProject("Other");
    const mine = await createRunEnvironment(project.id, env("UAT"));
    const theirs = await createRunEnvironment(other.id, env("PRO"));
    const base = { name: "Mine", status: "ACTIVE" as const };

    await expect(
      updateProject(project.id, projectSchema.parse({ ...base, defaultEnvironmentId: theirs.id })),
    ).rejects.toThrow("this project's run environments");

    await updateProject(project.id, projectSchema.parse({ ...base, defaultEnvironmentId: "none" }));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).defaultEnvironmentId).toBeNull();

    // Leaving the field out leaves the default alone.
    await setDefaultRunEnvironment(mine.id);
    await updateProject(project.id, projectSchema.parse(base));
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).defaultEnvironmentId).toBe(mine.id);
  });

  it("cannot be named by a project that is only being created", async () => {
    const owner = await createUser("QA");
    await expect(
      createProjectViaService(projectSchema.parse({ name: "New", defaultEnvironmentId: "x" }), owner.id),
    ).rejects.toThrow("this project's run environments");
  });

  it("can be one of the environments a new project is created with, or none", async () => {
    const owner = await createUser("QA");
    const environments = [
      { name: "UAT", webBaseUrl: "https://uat.example.test", variables: [{ key: "PASSWORD", value: "x", secret: true }] },
      { name: "PRO", webBaseUrl: "https://example.test" },
    ];

    const withPro = await createProjectViaService(
      projectCreateSchema.parse({ name: "With PRO", environments, defaultEnvironmentName: "PRO" }),
      owner.id,
    );
    const withNone = await createProjectViaService(
      projectCreateSchema.parse({ name: "No default", environments, defaultEnvironmentName: null }),
      owner.id,
    );

    expect((await listRunEnvironments(withPro.id)).map((e) => [e.name, e.isDefault])).toEqual([
      ["PRO", true],
      ["UAT", false],
    ]);
    expect(withNone.defaultEnvironmentId).toBeNull();
    expect(await prisma.runEnvironment.count({ where: { projectId: withNone.id } })).toBe(2);

    // Nothing is left behind when the default names none of them.
    await expect(
      createProjectViaService(
        projectCreateSchema.parse({ name: "Bad", environments, defaultEnvironmentName: "SIT" }),
        owner.id,
      ),
    ).rejects.toThrow("one of the environments added");
    expect(await prisma.project.count({ where: { name: "Bad" } })).toBe(0);
    expect(() =>
      projectCreateSchema.parse({ name: "Twice", environments: [environments[0], environments[0]] }),
    ).toThrow("its own name");
  });

  it("is given to a copy's target from the source's default", async () => {
    const { project: source, module, owner } = await createProject("Source");
    const { project: target } = await createProject("Target");
    await createRunEnvironment(source.id, env("PRO"));
    const uat = await createRunEnvironment(source.id, env("UAT"));
    await setDefaultRunEnvironment(uat.id);
    await createTestCase(source.id, module.id, "TC-1");

    await copyToProject(
      source.id,
      { targetProjectId: target.id, scope: { kind: "project" }, mode: "skip", includeEnvironments: true, includeRequirements: false },
      owner.id,
    );

    const environments = await listRunEnvironments(target.id);
    expect(environments.find((e) => e.isDefault)?.name).toBe("UAT");
  });
});

describe("duplicateRunEnvironment", () => {
  it("copies everything, secrets included, under a free name, never as the default", async () => {
    const { project } = await createProject();
    const uat = await createRunEnvironment(project.id, {
      name: "UAT",
      webBaseUrl: "https://uat.example.test",
      startPath: "/kh/login",
      variables: [
        { key: "LOGIN_ID", value: "qa", secret: false },
        { key: "LOGIN_PASSWORD", value: "s3cret", secret: true },
      ],
    });

    const first = await duplicateRunEnvironment(uat.id);
    const second = await duplicateRunEnvironment(uat.id);

    expect([first.name, second.name]).toEqual(["UAT copy", "UAT copy 2"]);
    expect(first).toMatchObject({ webBaseUrl: "https://uat.example.test", startPath: "/kh/login", isDefault: false });
    expect(await resolveEnvironmentForRunner(first.id)).toMatchObject({
      vars: { LOGIN_ID: "qa", LOGIN_PASSWORD: "s3cret" },
      secretKeys: ["LOGIN_PASSWORD"],
    });
  });

  it("keeps a long name within the limit", async () => {
    const { project } = await createProject();
    const long = await createRunEnvironment(project.id, env("X".repeat(60)));

    const copy = await duplicateRunEnvironment(long.id);

    expect(copy.name).toHaveLength(60);
    expect(copy.name.endsWith(" copy")).toBe(true);
  });
});

describe("results by environment", () => {
  it("records where a result was tested, and accepts only the project's environments", async () => {
    const { project, module } = await createProject();
    const tester = await createUser("QA");
    const tc = await createTestCase(project.id, module.id, "TC-1");
    await createRunEnvironment(project.id, env("UAT"));

    await assertEnvironmentName(tc.id, "UAT");
    await assertEnvironmentName(tc.id, undefined);
    await expect(assertEnvironmentName(tc.id, "PRO")).rejects.toThrow("not one of this project's environments");

    const execution = await recordExecution(tc.id, tester.id, { status: "PASSED", environmentName: "UAT" });
    expect(execution.environmentName).toBe("UAT");
  });

  it("reports each case's latest result on one environment, Not Run where it has none", async () => {
    const { project, module } = await createProject();
    const tester = await createUser("QA");
    const a = await createTestCase(project.id, module.id, "TC-1");
    const b = await createTestCase(project.id, module.id, "TC-2");
    await createRunEnvironment(project.id, env("UAT"));
    await createRunEnvironment(project.id, env("PRO"));

    await recordExecution(a.id, tester.id, { status: "FAILED", environmentName: "PRO" });
    await recordExecution(a.id, tester.id, { status: "PASSED", environmentName: "UAT" });
    await recordExecution(b.id, tester.id, { status: "PASSED", environmentName: "UAT" });
    // A result from an environment since deleted is still reportable.
    await recordExecution(b.id, tester.id, { status: "BLOCKED", environmentName: "SIT" });

    expect(await listReportEnvironments(project.id)).toEqual(["UAT", "PRO", "SIT"]);

    const summary = async (environment?: string) => {
      const book = XLSX.read(await buildExcelReport(project.id, "summary", { environment }));
      const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]!]!, { header: 1 });
      const value = (label: string) => rows.find((row) => row[0] === label)?.[1];
      return {
        from: value("Results From"),
        passed: value("Passed"),
        failed: value("Failed"),
        blocked: value("Blocked"),
        notRun: value("Not Run"),
      };
    };

    expect(await summary()).toMatchObject({ passed: 1, blocked: 1, failed: 0, notRun: 0 });
    expect(await summary("PRO")).toEqual({ from: "PRO", passed: 0, failed: 1, blocked: 0, notRun: 1 });
    expect(await summary("UAT")).toEqual({ from: "UAT", passed: 2, failed: 0, blocked: 0, notRun: 0 });
  });
});
