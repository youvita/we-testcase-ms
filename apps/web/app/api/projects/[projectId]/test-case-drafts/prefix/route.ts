import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { draftPrefixSchema } from "@/lib/validations";
import { setDraftsPrefix } from "@/services/test-case-draft.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** Give these drafts one TC ID prefix — a module's, say. Blank: the default. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const body = draftPrefixSchema.parse(await readJson(request));
    return ok(await setDraftsPrefix(projectId, body.ids, body.tcIdPrefix));
  },
);
