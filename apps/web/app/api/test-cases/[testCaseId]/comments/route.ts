import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { commentSchema } from "@/lib/validations";
import { listComments, postComment } from "@/services/comment.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { testCaseId } = await params;
  await assertTestCaseAccess(testCaseId, user);
  return ok(await listComments(testCaseId));
});

/**
 * Post to the discussion: a comment, which notifies the PO, or a reply
 * under one, which notifies the people in that thread.
 *
 * Open to Developers as well as QA — unlike an execution, a comment records an
 * opinion rather than a test result, so it leaves the audit trail intact.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA, ROLES.DEVELOPER] },
  async (request, { params, user }) => {
    const { testCaseId } = await params;
    await assertTestCaseAccess(testCaseId, user);
    const input = commentSchema.parse(await readJson(request));
    const comment = await postComment(testCaseId, user, input);
    return ok(comment, 201);
  },
);
