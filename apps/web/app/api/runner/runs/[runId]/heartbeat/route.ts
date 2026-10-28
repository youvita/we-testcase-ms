import { ok } from "@/lib/api";
import { runnerRoute } from "@/lib/runner-auth";
import { heartbeat } from "@/services/test-run.service";

type Ctx = { params: Promise<{ runId: string }> };

/** "Still working." The answer says whether to stop. */
export const POST = runnerRoute<Ctx>(async (_request, { params }) => {
  const { runId } = await params;
  return ok(await heartbeat(runId));
});
