import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertDraftAccess } from "@/lib/project-access";
import { testCaseDraftSchema } from "@/lib/validations";
import { updateDraft } from "@/services/test-case-draft.service";

type Ctx = { params: Promise<{ draftId: string }> };

/** Edit a draft before accepting it. */
export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { draftId } = await params;
    await assertDraftAccess(draftId, user);
    const body = testCaseDraftSchema.parse(await readJson(request));
    await updateDraft(draftId, body);
    return ok({ updated: true });
  },
);
