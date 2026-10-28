import { ROLES } from "@/lib/constants";
import { badRequest, ok, readJson, route } from "@/lib/api";
import { assertProjectAccess } from "@/lib/project-access";
import {
  requirementDocKindSchema,
  requirementDocTextSchema,
} from "@/lib/validations";
import {
  createRequirementDoc,
  listRequirementDocs,
} from "@/services/requirement.service";
import { extractDocumentText, normalizeText } from "@/utils/document-text";

type Ctx = { params: Promise<{ projectId: string }> };

/** PDF and Word parsing need Node, not the edge runtime. */
export const runtime = "nodejs";

const MAX_DOC_BYTES = 20 * 1024 * 1024;

export const GET = route<Ctx>({}, async (_request, { params, user }) => {
  const { projectId } = await params;
  await assertProjectAccess(projectId, user);
  return ok(await listRequirementDocs(projectId));
});

/**
 * Add a document: a file as multipart form data (`file`, `title`, `kind`), or
 * pasted text as JSON. Only its text is kept. Reading requirements out of it is
 * a separate call — `POST /api/requirement-docs/:id/extract` — because that
 * needs the person's Claude subscription and the upload does not.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { projectId } = await params;
    await assertProjectAccess(projectId, user);

    const isForm = (request.headers.get("content-type") ?? "").includes(
      "multipart/form-data",
    );

    if (!isForm) {
      const body = requirementDocTextSchema.parse(await readJson(request));
      const doc = await createRequirementDoc(projectId, user.id, {
        title: body.title,
        kind: body.kind,
        fileName: null,
        content: normalizeText(body.content),
      });
      return ok(doc, 201);
    }

    const form = await request.formData().catch(() => {
      throw badRequest("Expected a multipart form upload");
    });
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw badRequest('No file was provided under the "file" field');
    }
    if (file.size > MAX_DOC_BYTES) {
      throw badRequest("The file is larger than 20 MB");
    }

    const content = await extractDocumentText({
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
    });
    const title =
      String(form.get("title") ?? "").trim() ||
      file.name.replace(/\.[^.]+$/, "");
    const kind = requirementDocKindSchema.catch("PRD").parse(form.get("kind"));

    const doc = await createRequirementDoc(projectId, user.id, {
      title,
      kind,
      fileName: file.name,
      content,
    });
    return ok(doc, 201);
  },
);
