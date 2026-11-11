import { suggestCaseUpdateSchema } from "@wetestcase/dto";

import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { startCaseUpdateSuggestion } from "@/services/ai-case-update.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

/**
 * Ask the AI how this case should change now that the PO has answered a
 * question about it. Returns the job to follow; its result is a suggestion
 * QA reviews before anything is saved.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    const input = suggestCaseUpdateSchema.parse(await readJson(request));
    return ok(await startCaseUpdateSuggestion(testCaseId, input, user), 202);
  },
);
