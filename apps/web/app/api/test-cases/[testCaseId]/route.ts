import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { testCaseSchema } from "@/lib/validations";
import {
  deleteTestCase,
  getTestCase,
  updateTestCase,
} from "@/services/test-case.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

export const GET = route<Ctx>({}, async (_request, { params }) => {
  const { testCaseId } = await params;
  return ok(await getTestCase(testCaseId));
});

export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params }) => {
    const { testCaseId } = await params;
    const body = testCaseSchema.parse(await readJson(request));
    return ok(await updateTestCase(testCaseId, body));
  },
);

export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params }) => {
    const { testCaseId } = await params;
    await deleteTestCase(testCaseId);
    return ok({ deleted: true });
  },
);
