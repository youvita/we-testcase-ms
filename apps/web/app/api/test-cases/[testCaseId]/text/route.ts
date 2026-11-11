import { caseTextSchema } from "@wetestcase/dto";

import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { updateCaseText } from "@/services/test-case.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

/**
 * Replace a case's preconditions, steps, expected result and open questions
 * — what a PO's answer on one of its requirements changes. Those who edit cases.
 */
export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    const input = caseTextSchema.parse(await readJson(request));
    return ok(await updateCaseText(testCaseId, input));
  },
);
