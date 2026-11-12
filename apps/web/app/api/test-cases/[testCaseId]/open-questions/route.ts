import { caseOpenQuestionsSchema } from "@wetestcase/dto";

import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { setCaseQuestions } from "@/services/case-questions.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

/**
 * Edit a case's open questions — kept on the requirements it verifies, or on
 * the case when it verifies none. QA and the PO (admins) keep them.
 */
export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    const { openQuestions } = caseOpenQuestionsSchema.parse(await readJson(request));
    return ok(await setCaseQuestions(testCaseId, openQuestions));
  },
);
