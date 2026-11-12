import { ROLES } from "@/lib/constants";
import { badRequest, ok, route } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { assertAttachmentAccess } from "@/lib/project-access";
import { deleteAttachment } from "@/services/attachment.service";

type Ctx = { params: Promise<{ attachmentId: string }> };

export const runtime = "nodejs";

export const DELETE = route<Ctx>(
  { roles: [ROLES.ADMIN, ROLES.QA] },
  async (_request, { params, user }) => {
    const { attachmentId } = await params;
    await assertAttachmentAccess(attachmentId, user);
    // A post's files go with the post: delete the comment instead.
    const found = await prisma.attachment.findUnique({ where: { id: attachmentId }, select: { commentId: true } });
    if (found?.commentId) throw badRequest("Delete the comment to remove its files");
    await deleteAttachment(attachmentId);
    return ok({ deleted: true });
  },
);
