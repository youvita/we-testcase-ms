import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { testCaseSchema } from "@/lib/validations";
import {
  deleteTestCase,
  getTestCase,
  updateTestCase,
} from "@/services/test-case.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { testCaseId } = await params;
  await assertTestCaseAccess(testCaseId, user);
  return ok(await getTestCase(testCaseId));
});

export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    const body = testCaseSchema.parse(await readJson(request));
    return ok(await updateTestCase(testCaseId, body));
  },
);

export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    await deleteTestCase(testCaseId);
    return ok({ deleted: true });
  },
);
