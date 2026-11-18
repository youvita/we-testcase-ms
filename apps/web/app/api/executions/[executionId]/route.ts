import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertExecutionAccess } from "@/lib/project-access";
import { executionEditSchema } from "@/lib/validations";
import { deleteExecution, updateExecution } from "@/services/execution.service";

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
    await assertExecutionAccess(executionId, user);
    const body = executionEditSchema.parse(await readJson(request));
    const execution = await updateExecution(
      executionId,
      { id: user.id, role: user.role },
      body,
    );
    return ok(execution);
  },
);

/**
 * Remove a recorded result. The recorder or an admin — and not the latest one
 * once a developer has answered it; the service enforces both.
 */
export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { executionId } = await params;
    await assertExecutionAccess(executionId, user);
    await deleteExecution(executionId, { id: user.id, role: user.role });
    return ok({ id: executionId });
  },
);
