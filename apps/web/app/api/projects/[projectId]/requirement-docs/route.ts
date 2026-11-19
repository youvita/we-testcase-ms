import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { isMultipart, readDocumentUpload } from "@/lib/document-upload";
import { assertProjectAccess } from "@/lib/project-access";
import {
  requirementDocFolderSchema,
  requirementDocKindSchema,
  requirementDocTextSchema,
} from "@/lib/validations";
import {
  createRequirementDoc,
  listRequirementDocs,
} from "@/services/requirement.service";
import { detectDocKind } from "@/utils/document-kind";
import { pastedDocumentText } from "@/utils/document-text";

type Ctx = { params: Promise<{ projectId: string }> };

/** PDF and Word parsing need Node, not the edge runtime. */
export const runtime = "nodejs";

export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  return ok(await listRequirementDocs(projectId));
});

/**
 * Add a document: a file as multipart form data (`file`, `title`, `kind`), or
 * pasted text as JSON. Without a `kind`, it is detected from the document. Only its text is kept. Reading requirements out of it is
 * a separate call — `POST /api/requirement-docs/:id/extract` — because that
 * needs the person's Claude subscription and the upload does not.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);

    if (!isMultipart(request)) {
      const body = requirementDocTextSchema.parse(await readJson(request));
      const content = pastedDocumentText(body.content);
      const kind = body.kind ?? detectDocKind({ title: body.title, content });
      const doc = await createRequirementDoc(projectId, user.id, {
        title: body.title,
        kind,
        folder: body.folder,
        fileName: null,
        content,
      });
      return ok({ ...doc, kind }, 201);
    }

    const { form, fileName, content } = await readDocumentUpload(request);
    const title =
      String(form.get("title") ?? "").trim() ||
      fileName.replace(/\.[^.]+$/, "");
    // No kind given (or one not known): detected from the document.
    const given = requirementDocKindSchema.safeParse(form.get("kind"));
    const kind = given.success ? given.data : detectDocKind({ title: form.get("title")?.toString(), fileName, content });
    const folder = requirementDocFolderSchema.parse(form.get("folder") ?? undefined);

    const doc = await createRequirementDoc(projectId, user.id, {
      title,
      kind,
      folder,
      fileName,
      content,
    });
    return ok({ ...doc, kind }, 201);
  },
);
