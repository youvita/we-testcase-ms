import { after } from "next/server";

import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { assertTestCaseAccess } from "@/lib/project-access";
import { commentSchema } from "@/lib/validations";
import { createComment, listComments } from "@/services/comment.service";
import { notifyNewComment } from "@/services/notify.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { testCaseId } = await params;
  await assertTestCaseAccess(testCaseId, user);
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
    await assertTestCaseAccess(testCaseId, user);
    const { body, kind } = commentSchema.parse(await readJson(request));
    const comment = await createComment(testCaseId, user.id, body, kind);
    // After the response: whoever posted should not wait on Telegram, and a
    // group that cannot be reached must not fail their comment.
    after(() => notifyNewComment(comment.id));
    return ok(comment, 201);
  },
);
