import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertRequirementAccess } from "@/lib/project-access";
import { requirementSchema } from "@/lib/validations";
import {
  deleteRequirement,
  updateRequirement,
} from "@/services/requirement.service";

type Ctx = { params: Promise<{ requirementId: string }> };

export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { requirementId } = await params;
    await assertRequirementAccess(requirementId, user);
    const body = requirementSchema.parse(await readJson(request));
    return ok(await updateRequirement(requirementId, body));
  },
);

/** Unlinks it from its test cases; the cases themselves stay. */
export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { requirementId } = await params;
    await assertRequirementAccess(requirementId, user);
    await deleteRequirement(requirementId);
    return ok({ deleted: true });
  },
);
