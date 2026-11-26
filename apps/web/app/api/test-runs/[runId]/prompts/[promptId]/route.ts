import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertTestRunAccess } from "@/lib/project-access";
import { runPromptAnswerSchema } from "@wetestcase/dto";
import { answerPrompt } from "@/services/run-prompt.service";

type Ctx = { params: Promise<{ runId: string; promptId: string }> };

/** QA's answer to a running script's question — the OTP it asked for. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { runId, promptId } = await params;
    await assertTestRunAccess(runId, user);
    const { answer } = runPromptAnswerSchema.parse(await readJson(request));
    await answerPrompt(runId, promptId, answer);
    return ok({ answered: true });
  },
);
