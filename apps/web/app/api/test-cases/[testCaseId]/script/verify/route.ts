import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { verifyAutomationScript } from "@/services/automation-script.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

/**
 * QA vouches for a draft script without waiting for it to pass — its
 * failures will then be recorded on the case.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    await verifyAutomationScript(testCaseId);
    return ok({ verified: true });
  },
);
