import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { exploreAppSchema } from "@/lib/validations";
import { startExploration } from "@/services/ai-explore.service";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Open pages of the app under test and have Claude suggest test cases from
 * them. Returns the job to poll; the suggestions arrive as drafts.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const body = exploreAppSchema.parse(await readJson(request));
    return ok(await startExploration(projectId, user, body), 202);
  },
);
