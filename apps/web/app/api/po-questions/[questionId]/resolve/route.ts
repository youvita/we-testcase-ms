import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { poQuestionResolveSchema } from "@/lib/validations";
import { assertPoQuestionAccess } from "@/lib/project-access";
import { resolvePoQuestion } from "@/services/clarification.service";

type Ctx = { params: Promise<{ questionId: string }> };

/** Settle a question for the PO, or open it again. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { questionId } = await params;
    await assertPoQuestionAccess(questionId, user);
    const { resolved } = poQuestionResolveSchema.parse(await readJson(request));
    return ok(await resolvePoQuestion(questionId, user, resolved));
  },
);
