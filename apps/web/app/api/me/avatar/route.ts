import { badRequest, ok, route } from "@/lib/api";
import { removeAvatar, saveAvatar } from "@/services/avatar.service";

export const runtime = "nodejs";

export const POST = route({}, async (request, { user }) => {
  const form = await request.formData().catch(() => {
    throw badRequest("Expected a multipart form upload");
  });

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw badRequest('No file was provided under the "file" field');
  }

  const updated = await saveAvatar(user.id, {
    name: file.name,
    bytes: Buffer.from(await file.arrayBuffer()),
  });

  return ok(updated);
});

export const DELETE = route({}, async (_request, { user }) => {
  const updated = await removeAvatar(user.id);
  return ok(updated);
});
