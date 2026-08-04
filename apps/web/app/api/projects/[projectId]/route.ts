import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { projectUpdateSchema } from "@/lib/validations";
import {
  deleteProject,
  getProjectWithStats,
  updateProject,
} from "@/services/project.service";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>({}, async (_request, { params }) => {
  const { projectId } = await params;
  return ok(await getProjectWithStats(projectId));
});

export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params }) => {
    const { projectId } = await params;
    const body = projectUpdateSchema.parse(await readJson(request));
    return ok(await updateProject(projectId, body));
  },
);

export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN] },
  async (_request, { params }) => {
    const { projectId } = await params;
    await deleteProject(projectId);
    return ok({ deleted: true });
  },
);
