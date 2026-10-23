import { ok, route } from "@/lib/api";
import { liveItemsOf } from "@/lib/live-frames";
import { assertTestRunAccess } from "@/lib/project-access";

type Ctx = { params: Promise<{ runId: string }> };

/** Which of the run's tests have a live picture right now. Polled by the page. */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { runId } = await params;
  await assertTestRunAccess(runId, user);
  return ok(liveItemsOf(runId));
});
