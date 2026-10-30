import { beforeEach, describe, expect, it, vi } from "vitest";

import { badRequest } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createProject, resetDatabase } from "@/test/db";

import { defineJob, enqueueJob, getJob, resumeJobs, type JobWork } from "./ai-job.service";

vi.mock("./claude-connection.service", () => ({
  requireClaudeToken: async () => "test-token",
}));

/** What the test kind does when it runs; each test sets it. */
let work: JobWork;
const ran: string[] = [];

// A real kind, with a builder of the test's own: this file does not load the
// service that normally defines it.
defineJob("TRIAGE_FAILURE", async (job) => {
  const label = (job.input as { label: string }).label;
  if (label === "gone") throw badRequest("The run item no longer exists.");
  return async (context) => {
    ran.push(label);
    return work(context);
  };
});

/** Forget that this process already resumed, as a fresh server would. */
function restartServer() {
  const runtime = (globalThis as { __aiJobs?: { resumed?: Promise<void> } }).__aiJobs!;
  delete runtime.resumed;
}

async function settled(jobId: string) {
  await vi.waitFor(
    async () => {
      const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
      if (job.status === "QUEUED" || job.status === "RUNNING") throw new Error("still going");
    },
    { timeout: 5_000, interval: 20 },
  );
  return prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
}

/** A job row as a server that stopped mid-way would have left it. */
async function leftBehind(
  projectId: string,
  userId: string,
  label: string,
  state: { status: "QUEUED" | "RUNNING"; attempts?: number; createdAt?: Date },
) {
  return prisma.aiJob.create({
    data: {
      projectId,
      createdById: userId,
      kind: "TRIAGE_FAILURE",
      input: { label },
      status: state.status,
      attempts: state.attempts ?? 0,
      createdAt: state.createdAt,
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  ran.length = 0;
  work = async () => "done";
});

describe("enqueueJob", () => {
  it("builds the job from its row and runs it", async () => {
    const { project, owner } = await createProject();

    const job = await enqueueJob({
      projectId: project.id,
      kind: "TRIAGE_FAILURE",
      userId: owner.id,
      input: { label: "a" },
    });

    const after = await settled(job.id);
    expect(after).toMatchObject({ status: "SUCCEEDED", summary: "done", attempts: 1 });
    expect(ran).toEqual(["a"]);
  });

  it("runs one person's jobs one at a time, in order", async () => {
    const { project, owner } = await createProject();
    let running = 0;
    let most = 0;
    work = async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 30));
      running -= 1;
      return "done";
    };

    const jobs = [];
    for (const label of ["1", "2", "3"]) {
      jobs.push(
        await enqueueJob({ projectId: project.id, kind: "TRIAGE_FAILURE", userId: owner.id, input: { label } }),
      );
    }
    for (const job of jobs) await settled(job.id);

    expect(ran).toEqual(["1", "2", "3"]);
    expect(most).toBe(1);
  });

  it("fails with the builder's reason when the job no longer makes sense", async () => {
    const { project, owner } = await createProject();

    const job = await enqueueJob({
      projectId: project.id,
      kind: "TRIAGE_FAILURE",
      userId: owner.id,
      input: { label: "gone" },
    });

    expect(await settled(job.id)).toMatchObject({
      status: "FAILED",
      error: "The run item no longer exists.",
    });
  });

  it("refuses a kind nothing has defined", async () => {
    const { project, owner } = await createProject();

    await expect(
      enqueueJob({ projectId: project.id, kind: "GENERATE_FRD", userId: owner.id }),
    ).rejects.toThrow(/No job builder for GENERATE_FRD/);
  });
});

describe("after a restart", () => {
  it("runs the jobs that were waiting, oldest first", async () => {
    const { project, owner } = await createProject();
    const older = await leftBehind(project.id, owner.id, "older", {
      status: "QUEUED",
      createdAt: new Date(Date.now() - 60_000),
    });
    const newer = await leftBehind(project.id, owner.id, "newer", { status: "QUEUED" });

    restartServer();
    await resumeJobs();

    expect((await settled(older.id)).status).toBe("SUCCEEDED");
    expect((await settled(newer.id)).status).toBe("SUCCEEDED");
    expect(ran).toEqual(["older", "newer"]);
  });

  it("starts a job that was running over, once", async () => {
    const { project, owner } = await createProject();
    const job = await leftBehind(project.id, owner.id, "again", { status: "RUNNING", attempts: 1 });

    restartServer();
    await resumeJobs();

    expect(await settled(job.id)).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
  });

  it("gives up on a job interrupted on its last start", async () => {
    const { project, owner } = await createProject();
    const job = await leftBehind(project.id, owner.id, "unlucky", { status: "RUNNING", attempts: 2 });

    restartServer();
    await resumeJobs();

    const after = await settled(job.id);
    expect(after.status).toBe("FAILED");
    expect(after.error).toMatch(/Interrupted each time it ran/);
    expect(ran).toEqual([]);
  });

  it("does not let a page's check fail jobs that are being taken back", async () => {
    const { project, owner } = await createProject();
    const job = await leftBehind(project.id, owner.id, "waiting", { status: "QUEUED" });

    restartServer();
    // A page polling at the moment the server comes up.
    const [, polled] = await Promise.all([resumeJobs(), getJob(job.id)]);

    expect(polled.status).not.toBe("FAILED");
    expect((await settled(job.id)).status).toBe("SUCCEEDED");
  });
});
