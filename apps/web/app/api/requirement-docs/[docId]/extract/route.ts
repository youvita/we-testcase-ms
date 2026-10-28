import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertRequirementDocAccess } from "@/lib/project-access";
import { startExtraction } from "@/services/ai-requirements.service";

type Ctx = { params: Promise<{ docId: string }> };

/** Start reading requirements out of the document. Returns the job to poll. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { docId } = await params;
    await assertRequirementDocAccess(docId, user);
    return ok(await startExtraction(docId, user), 202);
  },
);
