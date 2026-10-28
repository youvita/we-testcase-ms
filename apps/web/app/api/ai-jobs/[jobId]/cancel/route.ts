import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { assertAiJobAccess } from "@/lib/project-access";
import { cancelJob } from "@/services/ai-job.service";
import { cancelTestRun } from "@/services/test-run.service";

type Ctx = { params: Promise<{ jobId: string }> };

/**
 * Cancel an AI job — and, for one writing a script, the script check it is
 * waiting on, so the runner does not carry on for nothing.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { jobId } = await params;
    await assertAiJobAccess(jobId, user);
    const job = await cancelJob(jobId, user.name);
    const runId = (job.result as { currentRunId?: string | null } | null)?.currentRunId;
    if (runId) {
      await prisma.testRun
        .findUnique({ where: { id: runId }, select: { status: true } })
        .then((run) => (run && (run.status === "QUEUED" || run.status === "RUNNING") ? cancelTestRun(runId) : null))
        .catch(() => undefined);
    }
    return ok(job);
  },
);
