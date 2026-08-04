import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { executionEditSchema } from "@/lib/validations";
import { updateExecution } from "@/services/execution.service";

type Ctx = { params: Promise<{ executionId: string }> };

/**
 * Correct a recorded execution: status, actual result and comment.
 *
 * The tester and the timestamp are not in the schema and so cannot be rewritten
 * here. The service restricts editing to the original tester (or an admin) and
 * refreshes the test case's denormalized status afterwards.
 */
export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { executionId } = await params;
    const body = executionEditSchema.parse(await readJson(request));
    const execution = await updateExecution(
      executionId,
      { id: user.id, role: user.role },
      body,
    );
    return ok(execution);
  },
);
