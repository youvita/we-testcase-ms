import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { scriptWritingSchema } from "@/lib/validations";
import { startScriptWriting } from "@/services/ai-scripts.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

/**
 * Have Claude write this case's script against an environment. Returns the
 * job to poll; the script lands in the job's result for QA to review — it is
 * never saved on its own.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    const body = scriptWritingSchema.parse(await readJson(request));
    return ok(await startScriptWriting(testCaseId, user, body), 202);
  },
);
