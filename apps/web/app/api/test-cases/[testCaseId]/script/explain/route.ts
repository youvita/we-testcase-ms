import { scriptExplainSchema } from "@wetestcase/dto";

import { ok, readJson, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { explainScript } from "@/services/ai-script-explain.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

/**
 * Explain a case's script, or some of its lines, and answer questions on it.
 * Anyone who can open the case: reading a script is not changing it.
 */
export const POST = route<Ctx>({}, async (request, { params, user }) => {
  const { testCaseId } = await params;
  await assertTestCaseAccess(testCaseId, user);
  const input = scriptExplainSchema.parse(await readJson(request));
  return ok(await explainScript(testCaseId, user, input));
});
