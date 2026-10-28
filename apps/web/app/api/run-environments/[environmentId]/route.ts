import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertRunEnvironmentAccess } from "@/lib/project-access";
import { runEnvironmentSchema } from "@/lib/validations";
import {
  deleteRunEnvironment,
  updateRunEnvironment,
} from "@/services/run-environment.service";

type Ctx = { params: Promise<{ environmentId: string }> };

export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { environmentId } = await params;
    await assertRunEnvironmentAccess(environmentId, user);
    const body = runEnvironmentSchema.parse(await readJson(request));
    return ok(await updateRunEnvironment(environmentId, body));
  },
);

export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { environmentId } = await params;
    await assertRunEnvironmentAccess(environmentId, user);
    await deleteRunEnvironment(environmentId);
    return ok({ deleted: true });
  },
);
