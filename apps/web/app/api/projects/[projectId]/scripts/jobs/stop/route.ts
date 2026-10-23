import { z } from "zod";

import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import { stopScriptBatch } from "@/services/ai-scripts.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** Stop the cases of a batch that have not started; the running one finishes. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);
    const { batchId } = z.object({ batchId: z.string().min(1) }).parse(await readJson(request));
    return ok({ stopped: await stopScriptBatch(projectId, batchId) });
  },
);
