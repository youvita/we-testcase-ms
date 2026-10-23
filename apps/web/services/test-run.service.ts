import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma, type TestRun } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { badRequest, conflict, notFound } from "@/lib/api";
import { PLATFORM_LABELS } from "@/lib/constants";
import {
  AUTOMATABLE_PLATFORMS,
  type RunArtifactDto,
  type RunArtifactKind,
  type RunnerItemResult,
  type RunnerJob,
  type TestRunCreateInput,
  type TestRunDetailDto,
  type TestRunDto,
} from "@wetestcase/dto";

import { resolveStoredPath } from "./attachment.service";
import { recordExecution } from "./execution.service";
import { resolveEnvironmentForRunner } from "./run-environment.service";

/**
 * Automated test runs.
 *
 * The app only queues and records. Executing is the runner service's job
 * (apps/runner): it claims a queued run over /api/runner/*, runs the scripts
 * with Playwright, reports each item with its evidence, and finishes the run.
 * It never touches the database itself.
 *
 *   QUEUED → RUNNING (claimed) → PASSED | FAILED | ERROR | CANCELLED
 *
 * A runner that dies mid-run stops sending heartbeats; the run is then marked
 * ERROR the next time anyone looks (see `sweepStaleRuns`).
 */

/** No heartbeat for this long means the runner is gone. It beats every 10 s. */
const STALE_AFTER_MS = 90_000;

const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

type RunRow = TestRun & { createdBy: { id: string; name: string } };

function toRunDto(run: RunRow): TestRunDto {
  return {
    id: run.id,
    number: run.number,
    status: run.status,
    environmentName: run.environmentName,
    recordResults: run.recordResults,
    total: run.total,
    passed: run.passed,
    failed: run.failed,
    errored: run.errored,
    skipped: run.skipped,
    error: run.error,
    cancelRequested: run.cancelRequested,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdBy: run.createdBy,
  };
}

type StoredArtifact = {
  kind: RunArtifactKind;
  path: string;
  fileName: string;
  mimeType: string;
  size: number;
};

function readArtifacts(value: Prisma.JsonValue | null): StoredArtifact[] {
  return Array.isArray(value) ? (value as unknown as StoredArtifact[]) : [];
}

// ---------------------------------------------------------------------------
// Creating and reading runs (people)
// ---------------------------------------------------------------------------

export async function createTestRun(
  projectId: string,
  userId: string,
  input: TestRunCreateInput & { scope: NonNullable<TestRunCreateInput["scope"]> },
): Promise<TestRunDto> {
  const environment = await prisma.runEnvironment.findFirst({
    where: { id: input.environmentId, projectId },
    select: { id: true, name: true, webBaseUrl: true, apiBaseUrl: true },
  });
  if (!environment) throw notFound("Environment");

  const cases = await prisma.testCase.findMany({
    where: {
      projectId,
      script: { isNot: null },
      platform: { in: [...AUTOMATABLE_PLATFORMS] },
      ...(input.scope === "failed" ? { status: "FAILED" } : {}),
      ...(input.scope === "module" ? { moduleId: input.moduleId } : {}),
      ...(input.scope === "cases" ? { id: { in: input.testCaseIds ?? [] } } : {}),
    },
    orderBy: [{ module: { position: "asc" } }, { tcId: "asc" }],
    select: { id: true, platform: true, script: { select: { code: true } } },
  });
  if (cases.length === 0) {
    throw badRequest(
      input.scope === "failed"
        ? "No failed test case in this project has a script."
        : "None of these test cases has an automation script yet.",
    );
  }

  // A relative goto() with no base URL fails every case in a confusing way;
  // say so before the run is queued.
  for (const platform of AUTOMATABLE_PLATFORMS) {
    const count = cases.filter((c) => c.platform === platform).length;
    const base = platform === "WEB" ? environment.webBaseUrl : environment.apiBaseUrl;
    if (count > 0 && !base) {
      throw badRequest(
        `${environment.name} has no ${PLATFORM_LABELS[platform]} base URL, and ${count} ${PLATFORM_LABELS[platform]} case${count === 1 ? " is" : "s are"} selected. Add it in Environments.`,
      );
    }
  }

  // Run numbers count per project. Two people starting a run in the same
  // instant collide on the unique index; the second simply tries again.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const run = await prisma.$transaction(async (tx) => {
        const last = await tx.testRun.aggregate({
          where: { projectId },
          _max: { number: true },
        });
        return tx.testRun.create({
          data: {
            projectId,
            number: (last._max.number ?? 0) + 1,
            environmentId: environment.id,
            environmentName: environment.name,
            recordResults: input.recordResults ?? true,
            createdById: userId,
            total: cases.length,
            items: {
              create: cases.map((c, position) => ({
                testCaseId: c.id,
                position,
                code: c.script!.code,
              })),
            },
          },
          include: { createdBy: { select: { id: true, name: true } } },
        });
      });
      return toRunDto(run);
    } catch (error) {
      const collided =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!collided || attempt >= 3) throw error;
    }
  }
}

/** Fail runs whose runner went quiet, so nobody waits on them forever. */
export async function sweepStaleRuns() {
  const stale = await prisma.testRun.findMany({
    where: {
      status: "RUNNING",
      heartbeatAt: { lt: new Date(Date.now() - STALE_AFTER_MS) },
    },
    select: { id: true },
  });
  for (const run of stale) {
    await finishRun(run.id, {
      error: "The runner stopped responding during this run. Check that the runner container is up, then run again.",
    });
  }
}

const runInclude = { createdBy: { select: { id: true, name: true } } } as const;

export async function listTestRuns(projectId: string, limit = 30): Promise<TestRunDto[]> {
  await sweepStaleRuns();
  const runs = await prisma.testRun.findMany({
    where: { projectId },
    orderBy: { number: "desc" },
    take: limit,
    include: runInclude,
  });
  return runs.map(toRunDto);
}

export async function getTestRun(runId: string): Promise<TestRunDetailDto> {
  await sweepStaleRuns();
  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    include: {
      ...runInclude,
      items: {
        orderBy: { position: "asc" },
        include: {
          testCase: {
            select: { id: true, tcId: true, title: true, platform: true },
          },
        },
      },
    },
  });
  if (!run) throw notFound("Run");

  return {
    ...toRunDto(run),
    items: run.items.map((item) => ({
      id: item.id,
      status: item.status,
      position: item.position,
      durationMs: item.durationMs,
      error: item.error,
      log: item.log,
      code: item.code,
      testCase: item.testCase,
      executionId: item.executionId,
      artifacts: readArtifacts(item.artifacts).map(
        (artifact, index): RunArtifactDto => ({
          index,
          kind: artifact.kind,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          size: artifact.size,
        }),
      ),
    })),
  };
}

/** One stored evidence file of an item, by its position in the list. */
export async function getRunArtifact(itemId: string, index: number) {
  const item = await prisma.testRunItem.findUnique({
    where: { id: itemId },
    select: { artifacts: true },
  });
  const artifact = item ? readArtifacts(item.artifacts)[index] : undefined;
  if (!artifact) throw notFound("Artifact");
  return artifact;
}

/**
 * Stop a run. A queued one ends at once; a running one is flagged, and the
 * runner stops at its next heartbeat and finishes it as CANCELLED.
 */
export async function cancelTestRun(runId: string) {
  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  if (!run) throw notFound("Run");

  if (run.status === "QUEUED") {
    // Guarded on status: the runner may claim it between the read and here.
    const { count } = await prisma.testRun.updateMany({
      where: { id: runId, status: "QUEUED" },
      data: { cancelRequested: true },
    });
    if (count === 1) {
      await finishRun(runId, {});
      return;
    }
  }
  if (run.status === "QUEUED" || run.status === "RUNNING") {
    await prisma.testRun.update({
      where: { id: runId },
      data: { cancelRequested: true },
    });
    return;
  }
  throw conflict("This run has already finished.");
}

// ---------------------------------------------------------------------------
// Runner side (/api/runner/*)
// ---------------------------------------------------------------------------

/**
 * Hand the oldest queued run to a runner, or null when there is none.
 *
 * `FOR UPDATE SKIP LOCKED` lets several runners poll at once without two of
 * them taking the same run.
 */
export async function claimNextRun(runnerName: string): Promise<RunnerJob | null> {
  await sweepStaleRuns();

  for (;;) {
    const runId = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "TestRun"
        WHERE status = 'QUEUED'
        ORDER BY "createdAt"
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      const id = rows[0]?.id;
      if (!id) return null;
      const now = new Date();
      await tx.testRun.update({
        where: { id },
        data: { status: "RUNNING", startedAt: now, heartbeatAt: now, runnerName },
      });
      return id;
    });
    if (!runId) return null;

    const run = await prisma.testRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        project: { select: { name: true } },
        items: {
          orderBy: { position: "asc" },
          include: {
            testCase: { select: { tcId: true, title: true, platform: true } },
          },
        },
      },
    });

    const environment = await resolveEnvironmentForRunner(run.environmentId);
    if (!environment) {
      // Deleted while the run waited. Close it and look for the next one.
      await finishRun(run.id, {
        error: `The environment "${run.environmentName}" was deleted before this run started.`,
      });
      continue;
    }

    return {
      run: { id: run.id, number: run.number, projectName: run.project.name },
      environment,
      items: run.items.map((item) => ({
        id: item.id,
        tcId: item.testCase.tcId,
        title: item.testCase.title,
        platform: item.testCase.platform,
        code: item.code,
      })),
    };
  }
}

/** The runner is alive. Tells it whether someone asked to stop. */
export async function heartbeat(runId: string): Promise<{ cancel: boolean }> {
  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { status: true, cancelRequested: true },
  });
  if (!run) return { cancel: true };
  if (run.status !== "RUNNING") return { cancel: true };
  await prisma.testRun.update({
    where: { id: runId },
    data: { heartbeatAt: new Date() },
  });
  return { cancel: run.cancelRequested };
}

const ARTIFACT_TYPES: Record<RunArtifactKind, { mimeType: string; ext: string; magic: (b: Buffer) => boolean }[]> = {
  screenshot: [
    { mimeType: "image/png", ext: ".png", magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
    { mimeType: "image/jpeg", ext: ".jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  ],
  video: [
    { mimeType: "video/webm", ext: ".webm", magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  ],
  trace: [
    { mimeType: "application/zip", ext: ".zip", magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  ],
};

/**
 * Store one item's result and evidence; record it on the test case when the
 * run records results.
 *
 * Only PASSED and FAILED become executions. ERROR means the script could not
 * run at all — a fact about the script, not the product — and SKIPPED means
 * nothing ran.
 */
export async function reportItemResult(
  itemId: string,
  result: RunnerItemResult,
  files: { kind: RunArtifactKind; name: string; bytes: Buffer }[],
) {
  const item = await prisma.testRunItem.findUnique({
    where: { id: itemId },
    include: {
      run: {
        select: {
          id: true,
          number: true,
          projectId: true,
          status: true,
          recordResults: true,
          environmentName: true,
          createdById: true,
        },
      },
    },
  });
  if (!item) throw notFound("Run item");
  if (item.run.status !== "RUNNING") throw conflict("This run is not running.");
  if (item.status !== "QUEUED") throw conflict("This item already has a result.");

  const artifacts: StoredArtifact[] = [];
  for (const file of files) {
    if (file.bytes.length === 0 || file.bytes.length > MAX_ARTIFACT_BYTES) continue;
    const type = ARTIFACT_TYPES[file.kind]?.find((t) => t.magic(file.bytes));
    if (!type) continue; // Not what it claims to be — drop it rather than serve it.
    const relativePath = path.join(
      "runs",
      item.run.projectId,
      item.run.id,
      `${item.id}-${randomUUID()}${type.ext}`,
    );
    const absolutePath = resolveStoredPath(relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.bytes);
    artifacts.push({
      kind: file.kind,
      path: relativePath,
      fileName: path.basename(file.name).slice(0, 120) || `${file.kind}${type.ext}`,
      mimeType: type.mimeType,
      size: file.bytes.length,
    });
  }

  let executionId: string | null = null;
  if (item.run.recordResults && (result.status === "PASSED" || result.status === "FAILED")) {
    const execution = await recordExecution(item.testCaseId, item.run.createdById, {
      status: result.status,
      actualResult: result.status === "FAILED" ? (result.error?.slice(0, 4000) ?? null) : null,
      comment: `Automated — Run #${item.run.number} on ${item.run.environmentName}`,
    });
    executionId = execution.id;
  }

  await prisma.testRunItem.update({
    where: { id: itemId },
    data: {
      status: result.status,
      durationMs: result.durationMs ?? null,
      error: result.error?.slice(0, 20_000) ?? null,
      log: result.log?.slice(-20_000) ?? null,
      artifacts: artifacts as unknown as Prisma.InputJsonValue,
      finishedAt: new Date(),
      executionId,
    },
  });
}

/**
 * Close a run: anything without a result is SKIPPED, counts are totalled and
 * the final status decided. Called by the runner when done, by a cancel, and
 * by the stale sweep.
 */
export async function finishRun(runId: string, options: { error?: string }) {
  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { status: true, cancelRequested: true },
  });
  if (!run) throw notFound("Run");
  if (run.status !== "QUEUED" && run.status !== "RUNNING") return;

  await prisma.testRunItem.updateMany({
    where: { runId, status: "QUEUED" },
    data: { status: "SKIPPED" },
  });
  const grouped = await prisma.testRunItem.groupBy({
    by: ["status"],
    where: { runId },
    _count: { _all: true },
  });
  const count = (status: string) =>
    grouped.find((row) => row.status === status)?._count._all ?? 0;
  const passed = count("PASSED");
  const failed = count("FAILED");
  const errored = count("ERROR");
  const skipped = count("SKIPPED");

  const status = run.cancelRequested
    ? "CANCELLED"
    : options.error
      ? "ERROR"
      : failed > 0 || errored > 0
        ? "FAILED"
        : passed > 0
          ? "PASSED"
          : "ERROR";

  await prisma.testRun.update({
    where: { id: runId },
    data: {
      status,
      passed,
      failed,
      errored,
      skipped,
      error:
        options.error ??
        (status === "ERROR" && passed + failed + errored === 0
          ? "Nothing ran. Check the runner log."
          : null),
      finishedAt: new Date(),
    },
  });
}
