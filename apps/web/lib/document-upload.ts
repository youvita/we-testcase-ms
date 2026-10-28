import { badRequest } from "@/lib/api";
import { extractDocumentText } from "@/utils/document-text";

const MAX_DOC_BYTES = 20 * 1024 * 1024;

export function isMultipart(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").includes("multipart/form-data");
}

/**
 * A requirements document uploaded as multipart form data under `file`: its
 * text, its name, and the form's other fields. Only the text is kept.
 */
export async function readDocumentUpload(request: Request) {
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
  return { form, fileName: file.name, content };
}
