import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { requirementDocFolderRenameSchema } from "@/lib/validations";
import { renameRequirementDocFolder } from "@/services/requirement.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** Rename a feature folder; its documents (and their requirements) follow. */
export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const { from, to } = requirementDocFolderRenameSchema.parse(await readJson(request));
    return ok(await renameRequirementDocFolder(projectId, from, to));
  },
);
