import {
  avatarETag,
  readAvatarBytes,
  statAvatar,
} from "@/services/avatar.service";
import { route } from "@/lib/api";

type Ctx = { params: Promise<{ userId: string }> };

export const runtime = "nodejs";

/**
 * Serve a user's avatar to any signed-in account.
 *
 * Avatars sit outside /public so this check exists — `route()` rejects
 * anonymous requests before a byte is read.
 */
export const GET = route<Ctx>({}, async (request, { params }) => {
  const { userId } = await params;
  const { absolutePath, mimeType, fileName, size } = await statAvatar(userId);
  const etag = avatarETag(userId, size);

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag },
    });
  }

  const bytes = await readAvatarBytes(absolutePath);

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(bytes.length),
      // Versioned via ?v= on the stored URL, so a short private cache is fine.
      "Cache-Control": "private, max-age=86400",
      ETag: etag,
      "Content-Disposition": `inline; filename="${fileName}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
