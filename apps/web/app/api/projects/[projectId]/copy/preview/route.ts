import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { projectCopySchema } from "@/lib/validations";
import { previewCopy } from "@/services/project-copy.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** Report what copying would do, without writing anything. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    const body = projectCopySchema.parse(await readJson(request));
    await assertProjectAccess(projectId, user);
    await assertProjectAccess(body.targetProjectId, user);
    return ok(await previewCopy(projectId, body));
  },
);
