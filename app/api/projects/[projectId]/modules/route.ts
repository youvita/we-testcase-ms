import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { moduleSchema } from "@/lib/validations";
import { createModule, listModules } from "@/services/module.service";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>({}, async (_request, { params }) => {
  const { projectId } = await params;
  return ok(await listModules(projectId));
});

export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params }) => {
    const { projectId } = await params;
    const body = moduleSchema.parse(await readJson(request));
    return ok(await createModule(projectId, body), 201);
  },
);
