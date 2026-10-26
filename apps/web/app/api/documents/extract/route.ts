import { ROLES } from "@/lib/constants";
import { badRequest, ok, route } from "@/lib/api";
import { extractDocumentText } from "@/utils/document-text";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Read a document's text without keeping it — for an FRD given to one AI
 * job. Saving a document for the project is Requirements → Documents.
 */
export const POST = route(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request) => {
    const form = await request.formData().catch(() => {
      throw badRequest("Expected a multipart form upload");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest('No file was provided under the "file" field');
    if (file.size > MAX_BYTES) throw badRequest("The file is larger than 20 MB");

    const text = await extractDocumentText({
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
    });
    if (!text.trim()) throw badRequest("No text could be read from that file.");
    return ok({ fileName: file.name, text, charCount: text.length });
  },
);
