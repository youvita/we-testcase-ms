import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { draftReviewSchema } from "@/lib/validations";
import { reviewDrafts } from "@/services/test-case-draft.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** Accept drafts into real test cases, or reject them. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const body = draftReviewSchema.parse(await readJson(request));
    return ok(await reviewDrafts(projectId, user.id, body));
  },
);
