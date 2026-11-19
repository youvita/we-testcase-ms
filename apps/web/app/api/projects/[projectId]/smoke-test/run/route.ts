import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { smokeTestRunSchema } from "@/lib/validations";
import { runSmokeTest } from "@/services/smoke-test.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** Start the smoke test against the chosen environment, or the project's default. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const body = smokeTestRunSchema.parse(await readJson(request));
    return ok(await runSmokeTest(projectId, user.id, body), 201);
  },
);
