import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { moduleSchema } from "@/lib/validations";
import { deleteModule, updateModule } from "@/services/module.service";

type Ctx = { params: Promise<{ moduleId: string }> };

export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params }) => {
    const { moduleId } = await params;
    const body = moduleSchema.parse(await readJson(request));
    return ok(await updateModule(moduleId, body));
  },
);

export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params }) => {
    const { moduleId } = await params;
    await deleteModule(moduleId);
    return ok({ deleted: true });
  },
);
