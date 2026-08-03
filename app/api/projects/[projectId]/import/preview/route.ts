import { ALLOWED_IMPORT_EXTENSIONS, ROLES } from "@/lib/constants";
import { badRequest, ok, route } from "@/lib/api";
import { previewImport } from "@/services/import.service";

type Ctx = { params: Promise<{ projectId: string }> };

/** SheetJS parses from a Node Buffer, so keep this off the edge runtime. */
export const runtime = "nodejs";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/**
 * Report what importing a file would do, without writing anything.
 *
 * Same guards as the import itself — an unreadable or oversized file should
 * fail here, before the user commits, rather than after.
 */
export const POST = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (request, { params }) => {
    const { projectId } = await params;

    const form = await request.formData().catch(() => {
      throw badRequest("Expected a multipart form upload");
    });

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw badRequest('No file was provided under the "file" field');
    }

    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_IMPORT_EXTENSIONS.includes(extension as never)) {
      throw badRequest(
        `Unsupported file type "${extension || "unknown"}". Upload ${ALLOWED_IMPORT_EXTENSIONS.join(", ")}.`,
      );
    }

    if (file.size > MAX_IMPORT_BYTES) {
      throw badRequest("The file is larger than 10 MB");
    }

    const preview = await previewImport(projectId, {
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
    });

    return ok(preview);
  },
);
