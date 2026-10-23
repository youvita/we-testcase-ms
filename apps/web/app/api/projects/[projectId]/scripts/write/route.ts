import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { scriptWritingBatchSchema } from "@/lib/validations";
import { startScriptWritingBatch } from "@/services/ai-scripts.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** Have Claude write scripts for several cases, one after another. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const body = scriptWritingBatchSchema.parse(await readJson(request));
    return ok(await startScriptWritingBatch(projectId, user, body), 202);
  },
);
