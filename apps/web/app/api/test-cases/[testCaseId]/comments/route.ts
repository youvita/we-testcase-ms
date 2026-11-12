import { ROLES } from "@/lib/constants";
import { badRequest, ok, readJson, route } from "@/lib/api";
import { isMultipart } from "@/lib/document-upload";
import { assertTestCaseAccess } from "@/lib/project-access";
import { commentSchema, commentWithFilesSchema } from "@/lib/validations";
import { prepareCommentFiles } from "@/services/attachment.service";
import { listComments, postComment } from "@/services/comment.service";

type Ctx = { params: Promise<{ testCaseId: string }> };

// Files are written with node fs.
export const runtime = "nodejs";

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
    if (!isMultipart(request)) {
      const input = commentSchema.parse(await readJson(request));
      return ok(await postComment(testCaseId, user, input), 201);
    }

    // With files: multipart, the text under `body`, each file under `files`.
    const form = await request.formData().catch(() => {
      throw badRequest("Expected a multipart form upload");
    });
    const files = form.getAll("files").filter((file): file is File => file instanceof File);
    const input = (files.length ? commentWithFilesSchema : commentSchema).parse({
      body: form.get("body") ?? "",
      replyToId: form.get("replyToId") ?? undefined,
      question: form.get("question") === "true" || undefined,
    });
    const prepared = await prepareCommentFiles(files);
    return ok(await postComment(testCaseId, user, input, prepared), 201);
  },
);
