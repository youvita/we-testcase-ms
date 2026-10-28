import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertAiJobAccess } from "@/lib/project-access";
import { retryJob } from "@/services/ai-retry.service";

type Ctx = { params: Promise<{ jobId: string }> };

/** Start a failed job again with the same request. Returns the new job. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { jobId } = await params;
    await assertAiJobAccess(jobId, user);
    return ok(await retryJob(jobId, user), 202);
  },
);
