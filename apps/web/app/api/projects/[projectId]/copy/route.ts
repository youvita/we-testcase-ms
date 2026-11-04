import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess, projectAccessWhere } from "@/lib/project-access";
import { projectCopySchema } from "@/lib/validations";
import { copyToProject, listCopyTargets } from "@/services/project-copy.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** The projects this viewer could copy into. */
export const GET = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    return ok(await listCopyTargets(projectId, projectAccessWhere(user)));
  },
);

/**
 * Copy cases into another project. Writing there needs the same access as
 * reading here: a project the viewer cannot open is "not found" either way.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    const body = projectCopySchema.parse(await readJson(request));
    await assertProjectAccess(projectId, user);
    await assertProjectAccess(body.targetProjectId, user);
    return ok(await copyToProject(projectId, body, user.id), 201);
  },
);
