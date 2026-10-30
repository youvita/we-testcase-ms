import type { AiJob, AiJobKind, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { HttpError, notFound } from "@/lib/api";
import { AiError } from "@/lib/claude";
import type { AiJobDto } from "@wetestcase/dto";

import { requireClaudeToken } from "./claude-connection.service";

/**
 * Background AI work.
 *
 * A job runs inside this server process, not in the request that started it:
 * Claude can take minutes, and the Cloudflare tunnel ends a request at 100
 * seconds. The route records the job and returns; the page polls it.
 *
 * Each person's jobs run one at a time, in order. They all draw on that
 * person's subscription, and running them side by side would only reach its
 * usage limit sooner.
 *
 * No queue service, but jobs survive a restart — a deploy is one. A job is
 * rebuilt from its row (kind, input, creator) by the builder its kind
 * registered with `defineJob`, never from memory, so when the server starts
 * again `resumeJobs` queues what was waiting and starts over what was running.
 * A job interrupted on each of its MAX_STARTS starts is failed instead: it may
 * be what is bringing the server down.
 */

export type JobContext = {
  jobId: string;
  /** The creator's subscription token. */
  token: string;
  progress: (done: number, total: number) => Promise<void>;
  /** Store what the job produced, as it goes — the page shows it live. */
  setResult: (result: Prisma.InputJsonValue) => Promise<void>;
  /** Stop here if someone cancelled the job. Call it before each long step. */
  throwIfCancelled: () => void;
};

/** Thrown at a checkpoint of a job that was cancelled while it ran. */
class JobCancelled extends Error {}

/** Does the work and returns the one-line summary shown when it succeeds. */
export type JobWork = (context: JobContext) => Promise<string>;

/** A job as stored: everything its work is rebuilt from. */
export type StoredJob = Pick<
  AiJob,
  "id" | "kind" | "input" | "projectId" | "docId" | "createdById" | "progressDone" | "attempts"
>;

/**
 * Turns a stored job into its work: reloads what it needs and checks it still
 * makes sense — the case or document may have gone while the job waited.
 */
export type JobBuilder = (job: StoredJob) => Promise<JobWork>;

/** Starts, counting the first, before an interrupted job is given up on. */
const MAX_STARTS = 2;

type Runtime = {
  /** Jobs this process owns, queued or running. */
  active: Set<string>;
  /** Running jobs asked to stop; they do at their next checkpoint. */
  cancelled: Set<string>;
  /** The tail of each user's queue. */
  queues: Map<string, Promise<void>>;
  builders: Map<AiJobKind, JobBuilder>;
  /** Set once this process has taken back the jobs a restart left. */
  resumed?: Promise<void>;
};

// On globalThis so dev hot reloads do not forget jobs that are still running.
const runtime: Runtime = ((globalThis as { __aiJobs?: Runtime }).__aiJobs ??= {
  active: new Set(),
  cancelled: new Set(),
  queues: new Map(),
  builders: new Map(),
});
// A runtime from before cancelling existed, kept across a dev hot reload.
runtime.cancelled ??= new Set();
runtime.builders ??= new Map();

/** Register how jobs of a kind are built. Each service does so for its own. */
export function defineJob(kind: AiJobKind, build: JobBuilder) {
  runtime.builders.set(kind, build);
}

const jobInclude = {
  createdBy: { select: { id: true, name: true } },
} as const;

type JobRow = AiJob & { createdBy: { id: string; name: string } };

function toDto(job: JobRow): AiJobDto {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progressDone: job.progressDone,
    progressTotal: job.progressTotal,
    summary: job.summary,
    error: job.error,
    docId: job.docId,
    result: job.result,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdBy: job.createdBy,
  };
}

/**
 * Record a job and queue it. `input` must hold everything the kind's builder
 * needs: after a restart, it is all there is.
 */
export async function enqueueJob(params: {
  projectId: string;
  kind: AiJobKind;
  userId: string;
  docId?: string;
  input?: Prisma.InputJsonValue;
}): Promise<AiJobDto> {
  if (!runtime.builders.has(params.kind)) {
    throw new Error(`No job builder for ${params.kind}: call defineJob in its service.`);
  }
  // Before the row exists, so "connect your subscription" is the answer to
  // the click rather than a job that fails a moment later.
  await requireClaudeToken(params.userId);

  const job = await prisma.aiJob.create({
    data: {
      projectId: params.projectId,
      kind: params.kind,
      createdById: params.userId,
      docId: params.docId ?? null,
      input: params.input,
    },
    include: jobInclude,
  });

  schedule(job.id, params.userId);
  return toDto(job);
}

/** Put a queued job at the end of its creator's line. */
function schedule(jobId: string, userId: string) {
  runtime.active.add(jobId);
  const previous = runtime.queues.get(userId) ?? Promise.resolve();
  const next = previous.then(() => run(jobId));
  runtime.queues.set(userId, next);
  void next.finally(() => {
    // Drop the tail only if nothing was queued behind it meanwhile.
    if (runtime.queues.get(userId) === next) {
      runtime.queues.delete(userId);
    }
  });
}

async function run(jobId: string) {
  try {
    // Guarded on QUEUED: a job stopped while it waited is skipped, not run.
    const { count } = await prisma.aiJob.updateMany({
      where: { id: jobId, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (count === 0) return;

    const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
    const build = runtime.builders.get(job.kind);
    if (!build) throw new Error(`No job builder for ${job.kind}`);
    // Read now rather than when queued: it may have been reconnected since.
    const token = await requireClaudeToken(job.createdById);
    const work = await build(job);

    const throwIfCancelled = () => {
      if (runtime.cancelled.has(jobId)) throw new JobCancelled();
    };
    const summary = await work({
      jobId,
      token,
      // Guarded on RUNNING: a cancelled job's row says so and stays that way.
      progress: async (done, total) => {
        throwIfCancelled();
        await prisma.aiJob.updateMany({
          where: { id: jobId, status: "RUNNING" },
          data: { progressDone: done, progressTotal: total },
        });
      },
      setResult: async (result) => {
        await prisma.aiJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { result } });
      },
      throwIfCancelled,
    });

    await prisma.aiJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: { status: "SUCCEEDED", summary, finishedAt: new Date() },
    });
  } catch (error) {
    // Cancelled: the row was marked when it was asked for.
    if (error instanceof JobCancelled || runtime.cancelled.has(jobId)) return;
    // AI and HTTP errors are written for people; anything else is not.
    const message =
      error instanceof AiError || error instanceof HttpError
        ? error.message
        : "The job failed unexpectedly. Try again, and check the server log if it keeps happening.";
    if (!(error instanceof AiError)) console.error(`[ai-job ${jobId}]`, error);

    await prisma.aiJob
      .updateMany({
        where: { id: jobId, status: "RUNNING" },
        data: { status: "FAILED", error: message, finishedAt: new Date() },
      })
      // The job itself may be gone — its project or document was deleted.
      .catch(() => undefined);
  } finally {
    runtime.active.delete(jobId);
    runtime.cancelled.delete(jobId);
  }
}

/**
 * Cancel a job. One still queued never starts; a running one is marked
 * cancelled at once and stops at its next checkpoint — an answer the AI is
 * already writing is let finish and thrown away.
 */
export async function cancelJob(jobId: string, byName: string): Promise<AiJobDto> {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!job) throw notFound("Job");
  if (job.status === "QUEUED" || job.status === "RUNNING") {
    if (job.status === "RUNNING") runtime.cancelled.add(jobId);
    await prisma.aiJob.updateMany({
      where: { id: jobId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "FAILED", error: `Cancelled by ${byName}.`, finishedAt: new Date() },
    });
  }
  return getJob(jobId);
}

/**
 * Stop jobs that have not started yet. Running ones finish — they are
 * mid-conversation with Claude and partway through the runner.
 */
export async function stopQueuedJobs(where: Prisma.AiJobWhereInput) {
  const { count } = await prisma.aiJob.updateMany({
    where: { ...where, status: "QUEUED" },
    data: { status: "FAILED", error: "Stopped before it started.", finishedAt: new Date() },
  });
  return count;
}

/**
 * Take back the jobs a restart left: queue the waiting ones again in the order
 * they were made, and start the running ones over — unless this was already
 * their last start. Called once, when the server starts (instrumentation.ts).
 */
export function resumeJobs(): Promise<void> {
  runtime.resumed ??= (async () => {
    const owned = Array.from(runtime.active);
    await prisma.aiJob.updateMany({
      where: { status: "RUNNING", attempts: { gte: MAX_STARTS }, id: { notIn: owned } },
      data: {
        status: "FAILED",
        error: "Interrupted each time it ran — the server restarted while it was running. Run it again.",
        finishedAt: new Date(),
      },
    });
    await prisma.aiJob.updateMany({
      where: { status: "RUNNING", id: { notIn: owned } },
      data: { status: "QUEUED" },
    });
    const waiting = await prisma.aiJob.findMany({
      where: { status: "QUEUED", id: { notIn: owned } },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdById: true },
    });
    for (const job of waiting) schedule(job.id, job.createdById);
    if (waiting.length > 0) console.log(`[ai-job] resumed ${waiting.length} job(s)`);
  })().catch((error) => {
    // Left for sweepInterrupted to fail, as before resuming existed.
    console.error("[ai-job] could not resume jobs", error);
  });
  return runtime.resumed;
}

/**
 * Mark jobs nobody is running as failed, so nobody waits on them. After a
 * restart, only once `resumeJobs` has had its chance to take them back.
 */
export async function sweepInterrupted(where: Prisma.AiJobWhereInput) {
  await runtime.resumed;
  await prisma.aiJob.updateMany({
    where: {
      ...where,
      status: { in: ["QUEUED", "RUNNING"] },
      id: { notIn: Array.from(runtime.active) },
    },
    data: {
      status: "FAILED",
      error: "Interrupted — the server restarted while this was running. Run it again.",
      finishedAt: new Date(),
    },
  });
}

export async function listJobs(
  projectId: string,
  options: { kinds?: AiJobKind[]; limit?: number } = {},
): Promise<AiJobDto[]> {
  await sweepInterrupted({ projectId });
  const jobs = await prisma.aiJob.findMany({
    where: { projectId, ...(options.kinds ? { kind: { in: options.kinds } } : {}) },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 10,
    include: jobInclude,
  });
  return jobs.map(toDto);
}

export async function getJob(jobId: string): Promise<AiJobDto> {
  await sweepInterrupted({ id: jobId });
  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    include: jobInclude,
  });
  if (!job) throw notFound("Job");
  return toDto(job);
}
