import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { commentSchema } from "@/lib/validations";
import { assertPoQuestionAccess } from "@/lib/project-access";
import { replyToPoQuestion } from "@/services/clarification.service";

type Ctx = { params: Promise<{ questionId: string }> };

/** Reply under a question for the PO: an admin's answer, or QA following up. */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { questionId } = await params;
    await assertPoQuestionAccess(questionId, user);
    const { body } = commentSchema.parse(await readJson(request));
    return ok(await replyToPoQuestion(questionId, user, body), 201);
  },
);
