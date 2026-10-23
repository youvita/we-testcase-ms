import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { automationScriptSchema } from "@/lib/validations";
import {
  deleteAutomationScript,
  getAutomationScript,
  saveAutomationScript,
} from "@/services/automation-script.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { testCaseId } = await params;
  await assertTestCaseAccess(testCaseId, user);
  return ok(await getAutomationScript(testCaseId));
});

export const PUT = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    const { code } = automationScriptSchema.parse(await readJson(request));
    return ok(await saveAutomationScript(testCaseId, user.id, code));
  },
);

export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    await deleteAutomationScript(testCaseId);
    return ok({ deleted: true });
  },
);
