import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { testRunCreateSchema } from "@/lib/validations";
import { createTestRun, listTestRuns } from "@/services/test-run.service";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  return ok(await listTestRuns(projectId));
});

/** Queue a run. The runner service picks it up within a few seconds. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const body = testRunCreateSchema.parse(await readJson(request));
    return ok(await createTestRun(projectId, user.id, body), 201);
  },
);
