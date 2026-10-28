import { ok, route } from "@/lib/api";
import { assertAiJobAccess } from "@/lib/project-access";
import { getJob } from "@/services/ai-job.service";

type Ctx = { params: Promise<{ jobId: string }> };

/** Polled by the page while a job runs. */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { jobId } = await params;
  await assertAiJobAccess(jobId, user);
  return ok(await getJob(jobId));
});
