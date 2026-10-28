import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { discardScriptJobs } from "@/services/ai-scripts.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

/** Clear the AI's script-writing history on this case. */
export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    return ok(await discardScriptJobs(testCaseId));
  },
);
