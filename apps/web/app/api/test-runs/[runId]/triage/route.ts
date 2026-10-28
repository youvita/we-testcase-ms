import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertTestRunAccess } from "@/lib/project-access";
import { startRunTriage } from "@/services/ai-scripts.service";

type Ctx = { params: Promise<{ runId: string }> };

/** Explain every failure in the run not explained yet, one job each. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { runId } = await params;
    await assertTestRunAccess(runId, user);
    return ok(await startRunTriage(runId, user), 202);
  },
);
