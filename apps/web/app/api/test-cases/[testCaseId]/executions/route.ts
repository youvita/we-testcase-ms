import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { executionSchema } from "@/lib/validations";
import { listExecutions, recordExecution } from "@/services/execution.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { testCaseId } = await params;
  await assertTestCaseAccess(testCaseId, user);
  return ok(await listExecutions(testCaseId));
});

/**
 * Record a result. Developers are blocked here — this is the endpoint that
 * enforces their read-only guarantee for test execution.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    const body = executionSchema.parse(await readJson(request));
    const execution = await recordExecution(testCaseId, user.id, body);
    return ok(execution, 201);
  },
);
