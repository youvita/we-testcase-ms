import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { requirementVerifySchema } from "@/lib/validations";
import { verifyRequirements } from "@/services/requirement.service";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * The PO confirms requirements are right (`verified: true`, the default) or
 * takes that back. Admins only: they are the product owners here.
 */
export const POST = route<Ctx>({ roles: [ROLES.ADMIN] }, async (request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  const { ids, verified } = requirementVerifySchema.parse(await readJson(request));
  return ok(await verifyRequirements(projectId, user.id, ids, verified));
});
