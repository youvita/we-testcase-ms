import { settleAnswerSchema } from "@wetestcase/dto";

import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertCommentAccess } from "@/lib/project-access";
import { settleAnswer } from "@/services/clarification.service";

type Ctx = { params: Promise<{ commentId: string }> };

/**
 * Deal with the PO's answer to a question on a case: put it into the case's
 * text (`update`), or record that it needed no change. Those who edit cases.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { commentId } = await params;
    await assertCommentAccess(commentId, user);
    const input = settleAnswerSchema.parse(await readJson(request));
    return ok(await settleAnswer(commentId, user, input));
  },
);
