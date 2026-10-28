import { ROLES } from "@/lib/constants";
import { ok, readJson, route } from "@/lib/api";
import { isMultipart, readDocumentUpload } from "@/lib/document-upload";
import { assertRequirementDocAccess } from "@/lib/project-access";
import { requirementDocVersionTextSchema } from "@/lib/validations";
import { addRequirementDocVersion } from "@/services/requirement.service";
import { normalizeText } from "@/utils/document-text";

type Ctx = { params: Promise<{ docId: string }> };

/** PDF and Word parsing need Node, not the edge runtime. */
export const runtime = "nodejs";

/**
 * Upload a newer version of the document: a file as multipart form data
 * (`file`), or pasted text as JSON. Reading it — and comparing its
 * requirements with the earlier version's — is the separate extract call.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params, user }) => {
    const { docId } = await params;
    await assertRequirementDocAccess(docId, user);

    if (!isMultipart(request)) {
      const body = requirementDocVersionTextSchema.parse(await readJson(request));
      return ok(
        await addRequirementDocVersion(docId, user.id, {
          fileName: null,
          content: normalizeText(body.content),
        }),
        201,
      );
    }

    const { fileName, content } = await readDocumentUpload(request);
    return ok(await addRequirementDocVersion(docId, user.id, { fileName, content }), 201);
  },
);
