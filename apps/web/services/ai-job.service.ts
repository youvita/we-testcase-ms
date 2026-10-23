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
 * No queue service: a server restart loses whatever was in flight. That is
 * detected rather than hidden — a job the database says is queued or running
 * but this process does not know about is marked failed the next time anyone
 * looks (see `sweepInterrupted`).
 */

export type JobContext = {
  jobId: string;
  /** The creator's subscription token. */
  token: string;
  progress: (done: number, total: number) => Promise<void>;
};

/** Does the work and returns the one-line summary shown when it succeeds. */
export type JobWork = (context: JobContext) => Promise<string>;

type Runtime = {
  /** Jobs this process owns, queued or running. */
  active: Set<string>;
  /** The tail of each user's queue. */
  queues: Map<string, Promise<void>>;
};

// On globalThis so dev hot reloads do not forget jobs that are still running.
const runtime: Runtime = ((globalThis as { __aiJobs?: Runtime }).__aiJobs ??= {
  active: new Set(),
  queues: new Map(),
});

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
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdBy: job.createdBy,
  };
}

export async function enqueueJob(
  params: {
    projectId: string;
    kind: AiJobKind;
    userId: string;
    docId?: string;
    input?: Prisma.InputJsonValue;
  },
  work: JobWork,
): Promise<AiJobDto> {
  // Before the row exists, so "connect your subscription" is the answer to
  // the click rather than a job that fails a moment later.
  const token = await requireClaudeToken(params.userId);

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

  runtime.active.add(job.id);
  const previous = runtime.queues.get(params.userId) ?? Promise.resolve();
  const next = previous.then(() => run(job.id, token, work));
  runtime.queues.set(params.userId, next);
  void next.finally(() => {
    // Drop the tail only if nothing was queued behind it meanwhile.
    if (runtime.queues.get(params.userId) === next) {
      runtime.queues.delete(params.userId);
    }
  });

  return toDto(job);
}

async function run(jobId: string, token: string, work: JobWork) {
  try {
    await prisma.aiJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    const summary = await work({
      jobId,
      token,
      progress: async (done, total) => {
        await prisma.aiJob.update({
          where: { id: jobId },
          data: { progressDone: done, progressTotal: total },
        });
      },
    });

    await prisma.aiJob.update({
      where: { id: jobId },
      data: { status: "SUCCEEDED", summary, finishedAt: new Date() },
    });
  } catch (error) {
    // AI and HTTP errors are written for people; anything else is not.
    const message =
      error instanceof AiError || error instanceof HttpError
        ? error.message
        : "The job failed unexpectedly. Try again, and check the server log if it keeps happening.";
    if (!(error instanceof AiError)) console.error(`[ai-job ${jobId}]`, error);

    await prisma.aiJob
      .update({
        where: { id: jobId },
        data: { status: "FAILED", error: message, finishedAt: new Date() },
      })
      // The job itself may be gone — its project or document was deleted.
      .catch(() => undefined);
  } finally {
    runtime.active.delete(jobId);
  }
}

/** Mark jobs left behind by a restart as failed, so nobody waits on them. */
async function sweepInterrupted(where: Prisma.AiJobWhereInput) {
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

export async function listJobs(projectId: string, limit = 10): Promise<AiJobDto[]> {
  await sweepInterrupted({ projectId });
  const jobs = await prisma.aiJob.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
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
