import { ok } from "@/lib/api";
import { runnerRoute } from "@/lib/runner-auth";
import { finishRun } from "@/services/test-run.service";

type Ctx = { params: Promise<{ runId: string }> };

/** The runner is done with the run; `error` when it could not complete it. */
export const POST = runnerRoute<Ctx>(async (request, { params }) => {
  const { runId } = await params;
  const body = (await request.json().catch(() => ({}))) as { error?: unknown };
  await finishRun(runId, {
    error: typeof body.error === "string" ? body.error.slice(0, 4000) : undefined,
  });
  return ok({ finished: true });
});
