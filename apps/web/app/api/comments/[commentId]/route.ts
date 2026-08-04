import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { deleteComment } from "@/services/comment.service";

type Ctx = { params: Promise<{ commentId: string }> };

/** Authors delete their own; the service enforces that, and admins override. */
export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA, ROLES.DEVELOPER] },
  async (_request, { params, user }) => {
    const { commentId } = await params;
    await deleteComment(commentId, { id: user.id, role: user.role });
    return ok({ id: commentId });
  },
);
