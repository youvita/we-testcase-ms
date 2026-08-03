import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  isVideoMimeType,
} from "@/lib/constants";

/**
 * Screenshots live outside /public and are served through
 * /api/attachments/[id]/file so access can be authorized. Paths are stored
 * relative to UPLOAD_DIR so the storage root can move between environments.
 */
function uploadRoot() {
  const configured = process.env.UPLOAD_DIR ?? "./uploads";
  return path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured);
}

/** Resolve a stored relative path, refusing anything that escapes the root. */
function resolveStoredPath(relativePath: string) {
  const root = uploadRoot();
  const absolute = path.resolve(root, relativePath);

  // Defence in depth against a traversal sequence reaching the database.
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw badRequest("Invalid attachment path");
  }
  return absolute;
}

/** Keep the original name for display, but never trust it on disk. */
function safeDisplayName(name: string) {
  // Drop directory components, quotes, backslashes and ASCII control
  // characters so the value is safe to echo into a Content-Disposition
  // header or rendered in the page.
  const base = path
    .basename(name)
    .replace(/[\u0000-\u001f"\\]/g, "")
    .trim();
  return base.slice(0, 180) || "screenshot";
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

/**
 * Magic-number check. The browser-supplied MIME type is attacker-controlled, so
 * the bytes themselves decide what this file really is.
 */
function sniffMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.subarray(0, 3).toString("latin1") === "GIF") {
    return "image/gif";
  }
  if (buffer.subarray(0, 4).toString("latin1") === "RIFF") {
    // RIFF is a container: WebP and WAV share the first four bytes, so the
    // form type at offset 8 is what actually identifies it.
    if (buffer.subarray(8, 12).toString("latin1") === "WEBP") {
      return "image/webp";
    }
    return null;
  }

  // Matroska/WebM — EBML header.
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return "video/webm";
  }

  // ISO base media format: a `ftyp` box whose brand separates MP4 from
  // QuickTime. The box length occupies the first four bytes, hence offset 4.
  if (buffer.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("latin1");
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }

  return null;
}

export async function saveAttachment(
  executionId: string,
  file: { name: string; type: string; bytes: Buffer },
) {
  const execution = await prisma.testExecution.findUnique({
    where: { id: executionId },
    select: { id: true, testCase: { select: { projectId: true } } },
  });
  if (!execution) throw notFound("Execution");

  if (file.bytes.length === 0) throw badRequest("The file is empty");

  // Sniff before checking the size: the limit depends on what the file is, and
  // only the bytes can be trusted to say.
  const sniffed = sniffMime(file.bytes);
  if (!sniffed || !ALLOWED_UPLOAD_MIME_TYPES.includes(sniffed as never)) {
    throw badRequest(
      "Only PNG, JPEG, GIF and WebP images, or MP4, WebM and QuickTime video, are supported",
    );
  }

  const video = isVideoMimeType(sniffed);
  const limit = video ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (file.bytes.length > limit) {
    throw badRequest(
      `${video ? "Videos" : "Screenshots"} must be ${Math.round(limit / 1024 / 1024)} MB or smaller`,
    );
  }

  const projectId = execution.testCase.projectId;
  const extension = EXTENSION_BY_MIME[sniffed] ?? ".bin";
  const relativePath = path.join(
    projectId,
    executionId,
    `${randomUUID()}${extension}`,
  );
  const absolutePath = resolveStoredPath(relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.bytes);

  return prisma.attachment.create({
    data: {
      executionId,
      fileName: safeDisplayName(file.name),
      filePath: relativePath,
      fileSize: file.bytes.length,
      mimeType: sniffed,
    },
  });
}

/**
 * Locate an attachment and measure it, without reading its contents.
 *
 * Serving a range means knowing the length before deciding what to read, so
 * this is deliberately separate from the byte read.
 */
export async function statAttachment(attachmentId: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: {
      execution: {
        select: { id: true, testCase: { select: { projectId: true } } },
      },
    },
  });
  if (!attachment) throw notFound("Attachment");

  try {
    // The file on disk is authoritative about its own length; the stored size
    // is only what was written at upload time.
    const { size } = await stat(resolveStoredPath(attachment.filePath));
    return { attachment, size };
  } catch {
    // The row exists but the file is gone (e.g. an ephemeral filesystem after a
    // redeploy). Report it as missing rather than a 500.
    throw notFound("Attachment file");
  }
}

/**
 * Read an attachment's bytes, optionally just one slice of them.
 *
 * Ranges are what make video playable: browsers seek by requesting them, and
 * Safari refuses to start a video at all against a server that ignores them.
 * The slice comes off a file handle rather than from slicing a full read — a
 * 50 MB clip seeked a dozen times would otherwise cost 50 MB per request.
 */
export async function readAttachmentBytes(
  attachment: { filePath: string },
  range?: { start: number; end: number },
) {
  const absolutePath = resolveStoredPath(attachment.filePath);

  try {
    if (!range) return await readFile(absolutePath);

    const length = range.end - range.start + 1;
    const handle = await open(absolutePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, range.start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    throw notFound("Attachment file");
  }
}

/**
 * Parse a single-range `Range` header against a known file size.
 *
 * Returns `null` when the header is absent or not a form we serve (multipart
 * ranges), and `"unsatisfiable"` when it is well-formed but out of bounds — the
 * caller owes the client a 416 for that.
 */
export function parseRangeHeader(
  header: string | null,
  size: number,
): { start: number; end: number } | null | "unsatisfiable" {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;

  if (!rawStart) {
    // A suffix range ("bytes=-500") asks for the last N bytes.
    const suffix = Number(rawEnd);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
  }

  if (start > end || start >= size) return "unsatisfiable";
  return { start, end };
}

/** Weak ETag so the browser can cache screenshots between renders. */
export function attachmentETag(id: string, size: number) {
  return `W/"${createHash("sha1").update(`${id}:${size}`).digest("hex")}"`;
}

export async function deleteAttachment(attachmentId: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, filePath: true },
  });
  if (!attachment) throw notFound("Attachment");

  await prisma.attachment.delete({ where: { id: attachmentId } });

  // Best effort: the row is the source of truth, a leftover file is harmless.
  try {
    await unlink(resolveStoredPath(attachment.filePath));
  } catch {
    /* already gone */
  }
}
