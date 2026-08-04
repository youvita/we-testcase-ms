import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { deleteAttachment } from "@/services/attachment.service";

type Ctx = { params: Promise<{ attachmentId: string }> };

export const runtime = "nodejs";

export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params }) => {
    const { attachmentId } = await params;
    await deleteAttachment(attachmentId);
    return ok({ deleted: true });
  },
);
