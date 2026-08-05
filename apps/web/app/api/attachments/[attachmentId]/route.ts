import { ROLES } from "@/lib/constants";
import { ok, route } from "@/lib/api";
import { assertAttachmentAccess } from "@/lib/project-access";
import { deleteAttachment } from "@/services/attachment.service";

type Ctx = { params: Promise<{ attachmentId: string }> };

export const runtime = "nodejs";

export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { attachmentId } = await params;
    await assertAttachmentAccess(attachmentId, user);
    await deleteAttachment(attachmentId);
    return ok({ deleted: true });
  },
);
