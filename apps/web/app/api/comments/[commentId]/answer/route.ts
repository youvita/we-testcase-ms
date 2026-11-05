import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { commentSchema } from "@/lib/validations";
import { answerQuestion } from "@/services/clarification.service";

type Ctx = { params: Promise<{ commentId: string }> };

/**
 * The PO answers a question on a case. Admins only — and admins open every
 * project, so there is no membership to check.
 */
export const POST = route<Ctx>({ roles: [ROLES.ADMIN] }, async (request, { params, user }) => {
  const { commentId } = await params;
  const { body } = commentSchema.parse(await readJson(request));
  return ok(await answerQuestion(commentId, user, body), 201);
});
