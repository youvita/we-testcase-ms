import { ok, route } from "@/lib/api";
import { assertTestRunAccess } from "@/lib/project-access";
import { listOpenPrompts } from "@/services/run-prompt.service";

type Ctx = { params: Promise<{ runId: string }> };

/** Questions the run's scripts are waiting on. Polled while it runs. */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { runId } = await params;
  await assertTestRunAccess(runId, user);
  return ok(await listOpenPrompts(runId));
});
