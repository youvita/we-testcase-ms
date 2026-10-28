import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { generateTestCasesSchema } from "@/lib/validations";
import { startGeneration } from "@/services/ai-requirements.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** Start drafting test cases for requirements. Returns the job to poll. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const body = generateTestCasesSchema.parse(await readJson(request));
    return ok(await startGeneration(projectId, user, body), 202);
  },
);
