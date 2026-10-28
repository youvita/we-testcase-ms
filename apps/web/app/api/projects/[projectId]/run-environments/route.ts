import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { runEnvironmentSchema } from "@/lib/validations";
import {
  createRunEnvironment,
  listRunEnvironments,
} from "@/services/run-environment.service";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  return ok(await listRunEnvironments(projectId));
});

export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const body = runEnvironmentSchema.parse(await readJson(request));
    return ok(await createRunEnvironment(projectId, body), 201);
  },
);
