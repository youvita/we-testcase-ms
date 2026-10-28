import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertTestRunAccess } from "@/lib/project-access";
import { cancelTestRun } from "@/services/test-run.service";

type Ctx = { params: Promise<{ runId: string }> };

export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { runId } = await params;
    await assertTestRunAccess(runId, user);
    await cancelTestRun(runId);
    return ok({ cancelled: true });
  },
);
