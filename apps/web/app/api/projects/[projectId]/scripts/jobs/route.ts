import { ok, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { listScriptJobs } from "@/services/ai-scripts.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** Script-writing progress of the last day. Polled by the test case list. */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  return ok(await listScriptJobs(projectId));
});
