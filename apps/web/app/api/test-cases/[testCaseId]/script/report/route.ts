import { z } from "zod";

import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { saveScriptAndReport } from "@/services/ai-scripts.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

const bodySchema = z.object({ jobId: z.string().min(1) });

/**
 * Save the AI's passing script on the case and report the pass it already
 * had as the case's result, instead of running it again.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    const { jobId } = bodySchema.parse(await readJson(request));
    return ok(await saveScriptAndReport(testCaseId, jobId, user));
  },
);
