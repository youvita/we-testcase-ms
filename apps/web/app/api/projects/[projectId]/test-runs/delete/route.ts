import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { testRunDeleteSchema } from "@/lib/validations";
import { deleteTestRuns } from "@/services/test-run.service";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Delete runs of this project, and the results they recorded when asked.
 * Their starter or an admin; the service checks each run.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const { runIds, withResults } = testRunDeleteSchema.parse(await readJson(request));
    return ok(await deleteTestRuns(projectId, runIds, { id: user.id, role: user.role }, withResults));
  },
);
