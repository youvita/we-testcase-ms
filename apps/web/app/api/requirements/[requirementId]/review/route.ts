import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertRequirementAccess } from "@/lib/project-access";
import { requirementReviewSchema } from "@/lib/validations";
import { reviewRequirement } from "@/services/requirement.service";

type Ctx = { params: Promise<{ requirementId: string }> };

/** Settle what a new document version did to it: keep, remove, restore, merge, notSame. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { requirementId } = await params;
    await assertRequirementAccess(requirementId, user);
    const { action } = requirementReviewSchema.parse(await readJson(request));
    await reviewRequirement(requirementId, action);
    return ok({ reviewed: true });
  },
);
