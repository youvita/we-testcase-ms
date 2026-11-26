import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma, type TestRun } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { badRequest, conflict, forbidden, HttpError, notFound } from "@/lib/api";
import { type Role } from "@/lib/constants";
import { isAdmin } from "@/lib/permissions";
import { dropFrame } from "@/lib/live-frames";
import { summariseFailure } from "@/utils/playwright-failure";
import {
  AUTOMATABLE_PLATFORMS,
  baseUrlKind,
  environmentBaseUrl,
  type WebSite,
  RUN_SPEEDS,
  type RunTriageDto,
  type RunArtifactDto,
  type FailedRequest,
  type RunArtifactKind,
  type RunnerItemResult,
  type RunnerJob,
  type TestRunCreateInput,
  type TestRunDetailDto,
  type TestRunDto,
  type Paginated,
} from "@wetestcase/dto";

import { attachRunEvidence, resolveStoredPath } from "./attachment.service";
import { verifyIfRanCurrentScript } from "./automation-script.service";
import { deleteExecution, recordExecution } from "./execution.service";
import { resolveEnvironmentForRunner } from "./run-environment.service";
import { isWaitingForAnswer } from "./run-prompt.service";

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

/** Letters and digits that cannot be mistaken for each other (no 0/O, 1/I/L). */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 5;

/** A run's code: "K7Q3P". Unique per project; a clash retries (see `queueRun`). */
export function newRunCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

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
    environmentId: run.environmentId,
    number: run.number,
    code: run.code,
    purpose: run.purpose,
    status: run.status,
    environmentName: run.environmentName,
    recordResults: run.recordResults,
    smoke: run.smoke,
    liveView: run.liveView,
    slowMoMs: run.slowMoMs,
    inOrder: run.inOrder,
    setupTcId: run.setupTcId,
    signInOnce: run.signInOnce,
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

const runInclude = { createdBy: { select: { id: true, name: true } } } as const;

// ---------------------------------------------------------------------------
// Creating and reading runs (people)
// ---------------------------------------------------------------------------

export async function createTestRun(
  projectId: string,
  userId: string,
  input: TestRunCreateInput & { scope: NonNullable<TestRunCreateInput["scope"]> },
  /** The project's smoke test: its cases, in its order — the scope is ignored. */
  options: { smoke?: boolean } = {},
): Promise<TestRunDto> {
  const smoke = options.smoke ?? false;
  const environment = await prisma.runEnvironment.findFirst({
    where: { id: input.environmentId, projectId },
    select: { id: true, name: true, webBaseUrl: true, apiBaseUrl: true, adminBaseUrl: true },
  });
  if (!environment) throw notFound("Environment");

  const cases = await prisma.testCase.findMany({
    where: {
      projectId,
      script: { isNot: null },
      platform: { in: [...AUTOMATABLE_PLATFORMS] },
      ...(smoke ? { smokePosition: { not: null } } : {}),
      // Failing: failed, or blocked before its steps — both need running again.
      ...(!smoke && input.scope === "failed" ? { status: { in: ["FAILED", "BLOCKED"] } } : {}),
      ...(!smoke && input.scope === "module"
        ? {
            OR: [
              { moduleId: { in: [...(input.moduleIds ?? []), ...(input.moduleId ? [input.moduleId] : [])] } },
              ...(input.subModules ?? []).map((sub) => ({ moduleId: sub.moduleId, subModule: sub.name })),
            ],
          }
        : {}),
      ...(!smoke && input.scope === "cases" ? { id: { in: input.testCaseIds ?? [] } } : {}),
    },
    orderBy: smoke ? [{ smokePosition: "asc" as const }] : [{ module: { position: "asc" } }, { tcId: "asc" }],
    select: { id: true, tcId: true, platform: true, site: true, script: { select: { code: true } } },
  });
  if (cases.length === 0) {
    throw badRequest(
      smoke
        ? "The smoke test has no case with an automation script yet. Add cases on the Automation page."
        : input.scope === "failed"
        ? "No failing or blocked test case in this project has a script."
        : "None of these test cases has an automation script yet.",
    );
  }

  // A relative goto() with no base URL fails every case in a confusing way;
  // say so before the run is queued.
  for (const kind of ["Web", "Admin", "API"] as const) {
    const count = cases.filter((c) => baseUrlKind(c) === kind).length;
    if (count > 0 && !environmentBaseUrl(environment, kind)) {
      throw badRequest(
        `${environment.name} has no ${kind} base URL, and ${count} ${kind} case${count === 1 ? " is" : "s are"} selected. Add it in Environments.`,
      );
    }
  }

  // "Sign in first": the chosen case's script opens each Web case, so a
  // case like "create a customer" need not repeat the login steps.
  // Only cases on the sign-in case's own site (Web or Admin) are opened
  // with it: signing in to one site does not sign in to the other.
  let setup: { id: string; tcId: string; site: WebSite; code: string } | null = null;
  if (input.setupTestCaseId) {
    const found = await prisma.testCase.findFirst({
      where: { id: input.setupTestCaseId, projectId, platform: "WEB" },
      select: { id: true, tcId: true, site: true, script: { select: { code: true } } },
    });
    if (!found?.script) throw badRequest("The sign-in case needs a Web automation script.");
    setup = { id: found.id, tcId: found.tcId, site: found.site, code: found.script.code };
  }

  return queueRun({
    projectId,
    userId,
    environment,
    purpose: "RUN",
    smoke,
    recordResults: input.recordResults ?? true,
    liveView: input.liveView ?? false,
    slowMoMs: RUN_SPEEDS[input.speed ?? "normal"],
    inOrder: input.inOrder ?? false,
    setup,
    signInOnce: Boolean(setup) && (input.signInOnce ?? true),
    items: cases.map((c) => ({
      testCaseId: c.id,
      // Stored with the prefix, so the run shows exactly what executed.
      code:
        setup && c.platform === "WEB" && c.site === setup.site && c.id !== setup.id
          ? `// ---- Sign in first: ${setup.tcId} ----\n${setup.code}\n\n// ---- ${c.tcId} ----\n${c.script!.code}`
          : c.script!.code,
    })),
  });
}

/**
 * Put a run on the queue for the runner.
 *
 * Runs are numbered per project. Two people starting one in the same instant
 * collide on the unique index; the second simply tries again. Script checks
 * take no number — nobody started them as a run.
 */
export async function queueRun(options: {
  projectId: string;
  userId: string;
  environment: { id: string; name: string };
  purpose: "RUN" | "SCRIPT_CHECK";
  smoke?: boolean;
  recordResults: boolean;
  liveView?: boolean;
  slowMoMs?: number;
  inOrder?: boolean;
  setup?: { id: string; tcId: string } | null;
  /** Sign in once for the whole run and share it. */
  signInOnce?: boolean;
  /**
   * testCaseId is null only for an exploration. `site` defaults to the
   * case's own (Web for an exploration).
   */
  items: { testCaseId: string | null; code: string; site?: WebSite }[];
}): Promise<TestRunDto> {
  // Which site each case's pages open on: the Web or Admin base URL.
  const caseIds = options.items.flatMap((i) => (i.testCaseId ? [i.testCaseId] : []));
  const siteOf = new Map(
    (
      await prisma.testCase.findMany({
        where: { id: { in: caseIds } },
        select: { id: true, site: true },
      })
    ).map((c) => [c.id, c.site]),
  );
  // Which cases' scripts are still drafts: their failures will not count.
  const verified = new Set(
    (
      await prisma.automationScript.findMany({
        where: {
          testCaseId: { in: options.items.flatMap((i) => (i.testCaseId ? [i.testCaseId] : [])) },
          verifiedAt: { not: null },
        },
        select: { testCaseId: true },
      })
    ).map((s) => s.testCaseId),
  );

  for (let attempt = 0; ; attempt += 1) {
    try {
      const run = await prisma.$transaction(async (tx) => {
        // Never a number given out before, even to a run since deleted.
        let number: number | null = null;
        if (options.purpose === "RUN") {
          const { lastRunNumber } = await tx.project.update({
            where: { id: options.projectId },
            data: { lastRunNumber: { increment: 1 } },
            select: { lastRunNumber: true },
          });
          const highest =
            (await tx.testRun.aggregate({ where: { projectId: options.projectId }, _max: { number: true } }))._max
              .number ?? 0;
          number = Math.max(lastRunNumber, highest + 1);
          if (number !== lastRunNumber) {
            await tx.project.update({ where: { id: options.projectId }, data: { lastRunNumber: number } });
          }
        }
        return tx.testRun.create({
          data: {
            projectId: options.projectId,
            number,
            code: options.purpose === "RUN" ? newRunCode() : null,
            purpose: options.purpose,
            environmentId: options.environment.id,
            environmentName: options.environment.name,
            // A script check never records: it is trying a draft, not testing.
            recordResults: options.purpose === "RUN" && options.recordResults,
            smoke: options.smoke ?? false,
            liveView: options.liveView ?? false,
            slowMoMs: options.slowMoMs ?? 0,
            inOrder: options.inOrder ?? false,
            setupTestCaseId: options.setup?.id ?? null,
            setupTcId: options.setup?.tcId ?? null,
            signInOnce: Boolean(options.setup) && (options.signInOnce ?? false),
            createdById: options.userId,
            total: options.items.length,
            items: {
              create: options.items.map((item, position) => ({
                testCaseId: item.testCaseId,
                position,
                code: item.code,
                site: item.site ?? (item.testCaseId ? siteOf.get(item.testCaseId) : undefined) ?? "WEB",
                draft: !item.testCaseId || !verified.has(item.testCaseId),
              })),
            },
          },
          include: runInclude,
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

/**
 * Delete runs — tries from while a script was still being fixed, say.
 *
 * Their starter or an admin, and never a run still going. The results they
 * recorded stay on the test cases unless `withResults`; then they go too,
 * except one a developer is working from (see `deleteExecution`). Numbers
 * are not given out again.
 */
export async function deleteTestRuns(
  projectId: string,
  runIds: string[],
  actor: { id: string; role: Role },
  withResults: boolean,
): Promise<{ deleted: number; resultsDeleted: number; resultsKept: number }> {
  const runs = await prisma.testRun.findMany({
    where: { id: { in: runIds }, projectId, purpose: "RUN" },
    select: {
      id: true,
      code: true,
      status: true,
      createdById: true,
      items: { select: { artifacts: true, executionId: true } },
    },
  });
  if (runs.length !== new Set(runIds).size) throw notFound("Run");
  for (const run of runs) {
    if (run.status === "QUEUED" || run.status === "RUNNING") {
      throw conflict(`Run #${run.code} is still going — cancel it first.`);
    }
    if (run.createdById !== actor.id && !isAdmin(actor.role)) {
      throw forbidden(`Run #${run.code} was started by someone else — only they or an admin can delete it.`);
    }
  }

  let resultsDeleted = 0;
  let resultsKept = 0;
  if (withResults) {
    for (const executionId of runs.flatMap((run) => run.items.flatMap((item) => (item.executionId ? [item.executionId] : [])))) {
      try {
        await deleteExecution(executionId, actor);
        resultsDeleted += 1;
      } catch (error) {
        // Kept: a developer is working from it, or it is someone else's.
        if (error instanceof HttpError && (error.status === 403 || error.status === 409)) resultsKept += 1;
        else if (!(error instanceof HttpError && error.status === 404)) throw error;
      }
    }
  }

  const files = runs.flatMap((run) => run.items.flatMap((item) => readArtifacts(item.artifacts)));
  await prisma.testRun.deleteMany({ where: { id: { in: runs.map((run) => run.id) } } });
  // Best effort: the rows are what count; a leftover file is harmless.
  await Promise.all(files.map((file) => unlink(resolveStoredPath(file.path)).catch(() => {})));
  return { deleted: runs.length, resultsDeleted, resultsKept };
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

/**
 * One page of a project's runs, newest first. A page past the end shows the
 * last one, so deleting or a stale link never lands on an empty table.
 */
export async function listTestRunsPage(
  projectId: string,
  options: { page: number; pageSize: number },
): Promise<Paginated<TestRunDto>> {
  await sweepStaleRuns();
  const where = { projectId, purpose: "RUN" as const };
  const total = await prisma.testRun.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / options.pageSize));
  const page = Math.min(Math.max(1, options.page), totalPages);
  const runs = await prisma.testRun.findMany({
    where,
    orderBy: { number: "desc" },
    skip: (page - 1) * options.pageSize,
    take: options.pageSize,
    include: runInclude,
  });
  return { items: runs.map(toRunDto), page, pageSize: options.pageSize, total, totalPages };
}

/** The newest run that finished and was not cancelled — what "last run" means. */
export async function getLastFinishedRun(projectId: string): Promise<TestRunDto | null> {
  const run = await prisma.testRun.findFirst({
    where: { projectId, purpose: "RUN", finishedAt: { not: null }, status: { not: "CANCELLED" } },
    orderBy: { number: "desc" },
    include: runInclude,
  });
  return run ? toRunDto(run) : null;
}

export async function listTestRuns(projectId: string, limit = 30): Promise<TestRunDto[]> {
  await sweepStaleRuns();
  const runs = await prisma.testRun.findMany({
    where: { projectId, purpose: "RUN" },
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
            select: {
              id: true,
              tcId: true,
              title: true,
              platform: true,
              script: { select: { code: true } },
            },
          },
        },
      },
    },
  });
  if (!run) throw notFound("Run");

  return {
    ...toRunDto(run),
    items: await Promise.all(run.items.map(async (item) => ({
      id: item.id,
      status: item.status,
      position: item.position,
      durationMs: item.durationMs,
      error: item.error,
      log: item.log,
      code: item.code,
      testCase: item.testCase
        ? {
            id: item.testCase.id,
            tcId: item.testCase.tcId,
            title: item.testCase.title,
            platform: item.testCase.platform,
          }
        : null,
      currentCode: item.testCase?.script?.code ?? null,
      draft: item.draft,
      failedRequests: await readFailedRequests(readArtifacts(item.artifacts)),
      executionId: item.executionId,
      triage: item.triage
        ? {
            ...(item.triage as unknown as Omit<RunTriageDto, "triagedAt">),
            triagedAt: item.triagedAt?.toISOString() ?? "",
          }
        : null,
      artifacts: readArtifacts(item.artifacts).map(
        (artifact, index): RunArtifactDto => ({
          index,
          kind: artifact.kind,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          size: artifact.size,
        }),
      ),
    }))),
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
      const run = await tx.testRun.update({
        where: { id },
        // The ask token is for every run: any script may ask a person for a value.
        data: {
          status: "RUNNING",
          startedAt: now,
          heartbeatAt: now,
          runnerName,
          askToken: randomBytes(24).toString("base64url"),
        },
        select: { liveView: true },
      });
      if (run.liveView) {
        await tx.testRun.update({
          where: { id },
          data: { liveToken: randomBytes(24).toString("base64url") },
        });
      }
      return id;
    });
    if (!runId) return null;

    try {
      const job = await buildRunnerJob(runId);
      if (job) return job;
    } catch (error) {
      // Claimed but not handed over: close it now rather than leave it
      // RUNNING with no runner until the stale sweep notices.
      await finishRun(runId, {
        error: `The run could not be started: ${error instanceof Error ? error.message : String(error)}`,
      }).catch(() => undefined);
      throw error;
    }
  }
}

/**
 * What the runner needs for a claimed run, or null when the run cannot go
 * ahead (it is then already finished, with the reason).
 */
async function buildRunnerJob(runId: string): Promise<RunnerJob | null> {
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
    // Deleted while the run waited. Close it; the caller looks for the next one.
    await finishRun(run.id, {
      error: `The environment "${run.environmentName}" was deleted before this run started.`,
    });
    return null;
  }

  return {
    run: {
      id: run.id,
      label: run.code ? `Run #${run.code}` : "Script check",
      projectName: run.project.name,
      slowMoMs: run.slowMoMs,
      inOrder: run.inOrder,
      signInOnce: run.signInOnce,
      liveToken: run.liveToken,
      askToken: run.askToken,
    },
    environment,
    items: run.items.map((item) => ({
      id: item.id,
      // An exploration has no case of its own; it is a Web page visit.
      tcId: item.testCase?.tcId ?? "EXPLORE",
      title: item.testCase?.title ?? "Exploring pages",
      platform: item.testCase?.platform ?? "WEB",
      site: item.site,
      code: item.code,
    })),
  };
}

/** The runner is alive. Tells it whether someone asked to stop. */
export async function heartbeat(runId: string): Promise<{ cancel: boolean; waitingForAnswer: boolean }> {
  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { status: true, cancelRequested: true },
  });
  if (!run) return { cancel: true, waitingForAnswer: false };
  if (run.status !== "RUNNING") return { cancel: true, waitingForAnswer: false };
  await prisma.testRun.update({
    where: { id: runId },
    data: { heartbeatAt: new Date() },
  });
  // A script waiting for a person (an OTP): the runner gives the run longer.
  return { cancel: run.cancelRequested, waitingForAnswer: await isWaitingForAnswer(runId) };
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
  // The failed requests, as JSON.
  network: [
    {
      mimeType: "application/json",
      ext: ".json",
      magic: (b) => {
        try {
          return b.length < 1_000_000 && Array.isArray(JSON.parse(b.toString("utf8")));
        } catch {
          return false;
        }
      },
    },
  ],
  // Every API call the script made, with bodies, as JSON.
  requests: [
    {
      mimeType: "application/json",
      ext: ".json",
      magic: (b) => {
        try {
          return b.length < 2_000_000 && Array.isArray(JSON.parse(b.toString("utf8")));
        } catch {
          return false;
        }
      },
    },
  ],
  // Plain text, so anything goes except binary — a NUL byte means it is not
  // the outline the runner writes.
  snapshot: [
    { mimeType: "text/plain; charset=utf-8", ext: ".txt", magic: (b) => b.length < 2_000_000 && !b.includes(0) },
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
          code: true,
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

  // A pass proves the script, if what ran is the case's current script.
  if (result.status === "PASSED" && item.testCaseId) {
    await verifyIfRanCurrentScript(item.testCaseId, item.code);
  }

  // A failure in the case's history reads like a tester wrote it: what went
  // wrong and at which step. One before step 1 — signing in, getting to the
  // start — means the case never ran its steps: blocked, not failed.
  const failure =
    result.status === "FAILED" && result.error ? summariseFailure(result.error, item.code) : null;

  // A draft script's failure says nothing reliable about the product — the
  // script may be what is wrong — so it is not recorded. Its pass is: the
  // product did what the case expects, and the script just proved itself.
  const recordAs =
    result.status === "PASSED"
      ? ("PASSED" as const)
      : result.status === "FAILED" && !item.draft
        ? failure?.beforeSteps
          ? ("BLOCKED" as const)
          : ("FAILED" as const)
        : null;

  let executionId: string | null = null;
  if (item.testCaseId && item.run.recordResults && recordAs) {
    const execution = await recordExecution(item.testCaseId, item.run.createdById, {
      status: recordAs,
      // In plain words; the full error, log and script are on the run's page,
      // which the history entry links to.
      actualResult: recordAs === "PASSED" ? null : (failure?.actualResult ?? "The script failed."),
      comment: `Automated — Run #${item.run.code} on ${item.run.environmentName}`,
      environmentName: item.run.environmentName,
    });
    executionId = execution.id;
    // Its screenshots and video, in the case's history like a tester's own.
    await attachRunEvidence(
      execution.id,
      item.run.projectId,
      artifacts.filter((artifact) => artifact.kind === "screenshot" || artifact.kind === "video"),
    );
  }

  dropFrame(itemId);
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
 * QA vouches that a draft script was right to fail: the product is what is
 * wrong. A script that catches a real bug never passes, so it would stay a
 * draft forever and its failures would never reach the case.
 *
 * Records this failure on the case as the run would have, with its evidence,
 * and — if what ran is still the case's script — verifies the script, so its
 * next failures count without asking.
 */
export async function recordDraftFailure(itemId: string, user: { id: string; name: string }) {
  const item = await prisma.testRunItem.findUnique({
    where: { id: itemId },
    select: {
      status: true,
      draft: true,
      code: true,
      error: true,
      artifacts: true,
      testCaseId: true,
      executionId: true,
      run: {
        select: { code: true, purpose: true, recordResults: true, environmentName: true, projectId: true, createdById: true },
      },
    },
  });
  if (!item) throw notFound("Run item");
  if (!item.testCaseId) throw badRequest("This result is not for a test case.");
  if (item.status !== "FAILED") throw badRequest("Only a failed result can be recorded this way.");
  if (item.executionId) throw conflict("This result is already recorded on the test case.");
  if (!item.draft) throw badRequest("This script was already verified; its result was recorded as it ran.");
  if (item.run.purpose !== "RUN" || !item.run.recordResults) {
    throw badRequest("This run does not record results on its test cases.");
  }

  await verifyIfRanCurrentScript(item.testCaseId, item.code);

  const failure = item.error ? summariseFailure(item.error, item.code) : null;
  const execution = await recordExecution(item.testCaseId, item.run.createdById, {
    status: failure?.beforeSteps ? "BLOCKED" : "FAILED",
    actualResult: failure?.actualResult ?? "The script failed.",
    comment: `Automated — Run #${item.run.code} on ${item.run.environmentName} · script confirmed by ${user.name}`,
    environmentName: item.run.environmentName,
  });
  await attachRunEvidence(
    execution.id,
    item.run.projectId,
    readArtifacts(item.artifacts).filter((artifact) => artifact.kind === "screenshot" || artifact.kind === "video"),
  );
  await prisma.testRunItem.update({ where: { id: itemId }, data: { executionId: execution.id } });
  return { executionId: execution.id };
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

// ---------------------------------------------------------------------------
// For AI jobs that run scripts and read the evidence
// ---------------------------------------------------------------------------

/**
 * Wait for a run to finish. Resolves with it either way; throws only when the
 * run is still going after `timeoutMs` (then cancels it, so it stops using
 * the runner).
 */
export async function waitForRun(runId: string, timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await sweepStaleRuns();
    const run = await prisma.testRun.findUniqueOrThrow({
      where: { id: runId },
      select: { status: true, startedAt: true },
    });
    if (run.status !== "QUEUED" && run.status !== "RUNNING") {
      return getTestRun(runId);
    }
    if (Date.now() > deadline) {
      await cancelTestRun(runId).catch(() => undefined);
      // Said to the person who started it, so it names what to look at.
      throw new HttpError(
        504,
        run.startedAt
          ? "The runner started the script check but did not finish it within 10 minutes. Check the runner's log (docker logs wetestcase-runner-dev)."
          : "The runner never picked up the script check. Make sure it is running and can reach this app — its log (docker logs wetestcase-runner-dev) says \"cannot reach the app\" when it cannot.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

/** The requests that went wrong during a test, from its "network" artifact. */
async function readFailedRequests(artifacts: StoredArtifact[]): Promise<FailedRequest[]> {
  const network = artifacts.find((a) => a.kind === "network");
  if (!network) return [];
  try {
    const parsed = JSON.parse(await readFile(resolveStoredPath(network.path), "utf8"));
    return Array.isArray(parsed) ? (parsed as FailedRequest[]).slice(0, 50) : [];
  } catch {
    return [];
  }
}

/** One item's evidence, read back for Claude: the page outline, screenshot and failed requests. */
export async function readItemEvidence(itemId: string) {
  const item = await prisma.testRunItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { artifacts: true },
  });
  const artifacts = readArtifacts(item.artifacts);
  const snapshot = artifacts.find((a) => a.kind === "snapshot");
  // The last screenshot is the page as the test left it.
  const screenshot = artifacts.filter((a) => a.kind === "screenshot").at(-1);

  const read = async (artifact: StoredArtifact | undefined) =>
    artifact
      ? readFile(resolveStoredPath(artifact.path)).catch(() => null)
      : null;

  const [snapshotBytes, screenshotBytes] = await Promise.all([
    read(snapshot),
    read(screenshot),
  ]);
  return {
    failedRequests: await readFailedRequests(artifacts),
    snapshot: snapshotBytes ? snapshotBytes.toString("utf8") : null,
    screenshot:
      screenshotBytes && screenshot
        ? { mediaType: screenshot.mimeType, data: screenshotBytes.toString("base64") }
        : null,
  };
}

/**
 * Which run a live frame belongs to, if the token is that run's.
 *
 * Test processes get this token instead of the runner's own: it is good only
 * for posting frames of one run while it is running.
 */
export async function authorizeLiveFrame(itemId: string, token: string) {
  const item = await prisma.testRunItem.findUnique({
    where: { id: itemId },
    select: { status: true, run: { select: { id: true, status: true, liveToken: true } } },
  });
  const expected = item?.run.liveToken;
  if (!item || !expected || item.run.status !== "RUNNING" || item.status !== "QUEUED") return null;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? item.run.id : null;
}

/**
 * Every page an item captured on purpose, in order: each outline with the
 * screenshot taken at the same moment. The runner's own end-of-test outline
 * and screenshot come last and repeat the final page, so they are dropped.
 */
export async function readItemPages(itemId: string, expected: number) {
  const item = await prisma.testRunItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { artifacts: true },
  });
  const artifacts = readArtifacts(item.artifacts);
  const snapshots = artifacts.filter((a) => a.kind === "snapshot").slice(0, expected);
  const screenshots = artifacts.filter((a) => a.kind === "screenshot").slice(0, expected);

  return Promise.all(
    snapshots.map(async (snapshot, index) => {
      const text = await readFile(resolveStoredPath(snapshot.path), "utf8").catch(() => "");
      const shot = screenshots[index];
      const image = shot
        ? await readFile(resolveStoredPath(shot.path)).catch(() => null)
        : null;
      const url = /^URL: (.*)$/m.exec(text)?.[1] ?? "";
      const title = /^Title: (.*)$/m.exec(text)?.[1] ?? "";
      return {
        url,
        title,
        outline: text,
        screenshot: image && shot ? { mediaType: shot.mimeType, data: image.toString("base64") } : null,
      };
    }),
  );
}
