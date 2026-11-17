import { commentEditSchema } from "@wetestcase/dto";

import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertCommentAccess } from "@/lib/project-access";
import { deleteComment, editComment } from "@/services/comment.service";

type Ctx = { params: Promise<{ commentId: string }> };

/** Authors delete their own; the service enforces that, and admins override. */
export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA, ROLES.DEVELOPER] },
  async (_request, { params, user }) => {
    const { commentId } = await params;
    await assertCommentAccess(commentId, user);
    await deleteComment(commentId, { id: user.id, role: user.role });
    return ok({ id: commentId });
  },
);

/** Authors change their own text; the service enforces that, admins included. */
export const PATCH = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA, ROLES.DEVELOPER] },
  async (request, { params, user }) => {
    const { commentId } = await params;
    await assertCommentAccess(commentId, user);
    const input = commentEditSchema.parse(await readJson(request));
    return ok(await editComment(commentId, { id: user.id }, input));
  },
);
