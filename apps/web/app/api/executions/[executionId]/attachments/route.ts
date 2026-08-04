import { ROLES } from "@/lib/constants";
import { badRequest, ok, route } from "@/lib/api";
import { saveAttachment } from "@/services/attachment.service";

type Ctx = { params: Promise<{ executionId: string }> };

// Uses node fs to persist the upload, so it must not run on the edge runtime.
export const runtime = "nodejs";

export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params }) => {
    const { executionId } = await params;

    const form = await request.formData().catch(() => {
      throw badRequest("Expected a multipart form upload");
    });

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw badRequest('No file was provided under the "file" field');
    }

    const attachment = await saveAttachment(executionId, {
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });

    return ok(attachment, 201);
  },
);
