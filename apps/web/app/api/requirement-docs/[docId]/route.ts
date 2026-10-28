import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertRequirementDocAccess } from "@/lib/project-access";
import {
  deleteRequirementDoc,
  getRequirementDoc,
} from "@/services/requirement.service";

type Ctx = { params: Promise<{ docId: string }> };

/** The document's text, for reading it alongside its requirements. */
export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { docId } = await params;
  await assertRequirementDocAccess(docId, user);
  return ok(await getRequirementDoc(docId));
});

export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { docId } = await params;
    await assertRequirementDocAccess(docId, user);
    await deleteRequirementDoc(docId);
    return ok({ deleted: true });
  },
);
