import { ok, route } from "@/lib/api";
import { assertTestRunAccess } from "@/lib/project-access";
import { getTestRun } from "@/services/test-run.service";

type Ctx = { params: Promise<{ runId: string }> };

/** Polled by the run page while the run is active. */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { runId } = await params;
  await assertTestRunAccess(runId, user);
  return ok(await getTestRun(runId));
});
