import { after } from "next/server";

import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { requirementCreateSchema } from "@/lib/validations";
import {
  createRequirement,
  listRequirements,
} from "@/services/requirement.service";
import { notifyRequirementQuestions } from "@/services/notify.service";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  return ok(await listRequirements(projectId));
});

/** A requirement added by hand — one extraction missed, or one never written down. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const { docId, ...body } = requirementCreateSchema.parse(
      await readJson(request),
    );
    const requirement = await createRequirement(projectId, docId, body);
    after(() => notifyRequirementQuestions(requirement.id, user, null));
    return ok(requirement, 201);
  },
);
