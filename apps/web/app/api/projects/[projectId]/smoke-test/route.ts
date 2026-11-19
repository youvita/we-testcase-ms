import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { smokeTestSchema } from "@/lib/validations";
import { getSmokeTest, saveSmokeTest } from "@/services/smoke-test.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** The project's smoke test: its cases in run order, and the sign-in case. */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  return ok(await getSmokeTest(projectId));
});

/** Replace the smoke test's cases (in this order) and sign-in case. */
export const PUT = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    return ok(await saveSmokeTest(projectId, smokeTestSchema.parse(await readJson(request))));
  },
);
