import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertRunEnvironmentAccess } from "@/lib/project-access";
import { duplicateRunEnvironment } from "@/services/run-environment.service";

type Ctx = { params: Promise<{ environmentId: string }> };

/** Copy an environment within its project. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { environmentId } = await params;
    await assertRunEnvironmentAccess(environmentId, user);
    return ok(await duplicateRunEnvironment(environmentId), 201);
  },
);
