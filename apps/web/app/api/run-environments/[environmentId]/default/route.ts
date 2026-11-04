import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertRunEnvironmentAccess } from "@/lib/project-access";
import { setDefaultRunEnvironment } from "@/services/run-environment.service";

type Ctx = { params: Promise<{ environmentId: string }> };

/** Make this environment its project's default. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { environmentId } = await params;
    await assertRunEnvironmentAccess(environmentId, user);
    await setDefaultRunEnvironment(environmentId);
    return ok({ isDefault: true });
  },
);
