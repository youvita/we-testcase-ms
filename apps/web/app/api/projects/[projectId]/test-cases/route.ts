import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import {
  testCaseBulkDeleteSchema,
  testCaseQuerySchema,
  testCaseSchema,
} from "@/lib/validations";
import {
  createTestCase,
  deleteTestCases,
  listTestCases,
} from "@/services/test-case.service";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>({}, async (request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  const url = new URL(request.url);

  // Blank and "ALL" values mean "no filter" — strip them before validating so
  // the schema does not have to model the UI's sentinel values.
  const raw = Object.fromEntries(
    [...url.searchParams.entries()].filter(
      ([, value]) => value !== "" && value !== "ALL",
    ),
  );

  const query = testCaseQuerySchema.parse(raw);
  return ok(await listTestCases(projectId, query));
});

export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const body = testCaseSchema.parse(await readJson(request));
    return ok(await createTestCase(projectId, body), 201);
  },
);

/**
 * Bulk delete. Takes the ids in the body rather than the query string so a
 * large selection cannot run into a URL length limit, and keeps the project in
 * the path so the service can scope the delete to it.
 */
export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const { ids } = testCaseBulkDeleteSchema.parse(await readJson(request));
    return ok(await deleteTestCases(projectId, ids));
  },
);
