import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { confirmRequirementChanges } from "@/services/test-case.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

/**
 * QA checked the case against the requirements that changed since it was
 * written, and it still holds: clear the "requirement changed" flag.
 */
export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    return ok(await confirmRequirementChanges(testCaseId));
  },
);
