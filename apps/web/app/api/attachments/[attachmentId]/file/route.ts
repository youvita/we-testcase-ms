import {
  attachmentETag,
  parseRangeHeader,
  readAttachmentBytes,
  statAttachment,
} from "@/services/attachment.service";
import { route } from "@/lib/api";
import { assertAttachmentAccess } from "@/lib/project-access";

type Ctx = { params: Promise<{ attachmentId: string }> };

export const runtime = "nodejs";

/**
 * Serve an attachment to any signed-in user.
 *
 * Attachments are stored outside /public precisely so this check exists —
 * `route()` rejects anonymous requests before a byte is read.
 *
 * Range requests are honoured because video depends on them: a browser seeks by
 * asking for a byte range, and Safari will not begin playback at all against a
 * server that ignores them.
 */
export const GET = route<Ctx>({}, async (request, { params, user }) => {
  const { attachmentId } = await params;
  await assertAttachmentAccess(attachmentId, user);

  const { attachment, size } = await statAttachment(attachmentId);
  const etag = attachmentETag(attachment.id, size);
  const range = parseRangeHeader(request.headers.get("range"), size);

  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  // Only a full response can be replaced by a 304 — a 206 has to carry bytes.
  if (!range && request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Accept-Ranges": "bytes" },
    });
  }

  const bytes = await readAttachmentBytes(attachment, range ?? undefined);

  const headers: Record<string, string> = {
    "Content-Type": attachment.mimeType,
    "Content-Length": String(bytes.length),
    "Accept-Ranges": "bytes",
    // Attachment bytes never change once written, but the URL requires a
    // session, so keep it private to the browser cache.
    "Cache-Control": "private, max-age=31536000, immutable",
    ETag: etag,
    "Content-Disposition": `inline; filename="${attachment.fileName}"`,
    "X-Content-Type-Options": "nosniff",
  };

  if (range) {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  }

  return new Response(new Uint8Array(bytes), {
    status: range ? 206 : 200,
    headers,
  });
});
