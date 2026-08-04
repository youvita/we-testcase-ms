import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { commentSchema } from "@/lib/validations";
import { createComment, listComments } from "@/services/comment.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

export const GET = route<Ctx>({}, async (_request, { params }) => {
  const { testCaseId } = await params;
  return ok(await listComments(testCaseId));
});

/**
 * Post to the discussion.
 *
 * Open to Developers as well as QA — unlike an execution, a comment records an
 * opinion rather than a test result, so it leaves the audit trail intact.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA, ROLES.DEVELOPER] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    const { body } = commentSchema.parse(await readJson(request));
    const comment = await createComment(testCaseId, user.id, body);
    return ok(comment, 201);
  },
);
