import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_COMMENT_FILES,
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
export function resolveStoredPath(relativePath: string) {
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

// ---------------------------------------------------------------------------
// Files posted in a case's discussion
// ---------------------------------------------------------------------------

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Documents a discussion takes beside images and video, by extension. */
const DOCUMENT_TYPES: Record<string, { mime: string; kind: "pdf" | "zip" | "ole" | "text" }> = {
  ".pdf": { mime: "application/pdf", kind: "pdf" },
  ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "zip" },
  ".xlsx": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "zip" },
  ".pptx": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "zip" },
  ".doc": { mime: "application/msword", kind: "ole" },
  ".xls": { mime: "application/vnd.ms-excel", kind: "ole" },
  ".zip": { mime: "application/zip", kind: "zip" },
  ".txt": { mime: "text/plain", kind: "text" },
  ".log": { mime: "text/plain", kind: "text" },
  ".md": { mime: "text/plain", kind: "text" },
  ".csv": { mime: "text/csv", kind: "text" },
  ".json": { mime: "application/json", kind: "text" },
};

/**
 * A document's type: its extension says what it claims to be, and its bytes
 * must agree — a PDF starts `%PDF-`, Office files are zip or OLE containers,
 * and text has no NUL bytes. Anything else is refused.
 */
function documentType(name: string, buffer: Buffer): { mime: string; extension: string } | null {
  const extension = path.extname(name).toLowerCase();
  const type = DOCUMENT_TYPES[extension];
  if (!type) return null;
  const head = buffer.subarray(0, 8);
  const fits =
    type.kind === "pdf"
      ? head.subarray(0, 5).toString("latin1") === "%PDF-"
      : type.kind === "zip"
        ? head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
        : type.kind === "ole"
          ? head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
          : !buffer.subarray(0, 64 * 1024).includes(0);
  return fits ? { mime: type.mime, extension } : null;
}

export type PreparedFile = {
  fileName: string;
  mimeType: string;
  extension: string;
  bytes: Buffer;
};

/**
 * Check the files posted with a comment before anything is saved: what they
 * are (from their bytes), how many, and how big. Throws a 400 naming the file.
 */
export async function prepareCommentFiles(files: File[]): Promise<PreparedFile[]> {
  if (files.length > MAX_COMMENT_FILES) {
    throw badRequest(`Attach at most ${MAX_COMMENT_FILES} files to one comment`);
  }
  const prepared: PreparedFile[] = [];
  for (const file of files) {
    const fileName = safeDisplayName(file.name);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) throw badRequest(`“${fileName}” is empty`);

    const sniffed = sniffMime(bytes);
    if (sniffed && ALLOWED_UPLOAD_MIME_TYPES.includes(sniffed as never)) {
      const limit = isVideoMimeType(sniffed) ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
      if (bytes.length > limit) {
        throw badRequest(`“${fileName}” is larger than ${Math.round(limit / 1024 / 1024)} MB`);
      }
      prepared.push({ fileName, mimeType: sniffed, extension: EXTENSION_BY_MIME[sniffed] ?? ".bin", bytes });
      continue;
    }

    const document = documentType(file.name, bytes);
    if (!document) {
      throw badRequest(
        `“${fileName}” can't be attached — use an image, a video, a PDF, an Office file, a zip, or a text or log file`,
      );
    }
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      throw badRequest(`“${fileName}” is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`);
    }
    prepared.push({ fileName, mimeType: document.mime, extension: document.extension, bytes });
  }
  return prepared;
}

/**
 * Write a post's files to disk, ahead of the post itself: what comes back is
 * the rows to create with it, and `discard` takes the files away again should
 * the post not be saved.
 */
export async function storeCommentFiles(projectId: string, files: PreparedFile[]) {
  const rows: { fileName: string; filePath: string; fileSize: number; mimeType: string }[] = [];
  const discard = () => Promise.all(rows.map((row) => unlink(resolveStoredPath(row.filePath)).catch(() => {})));
  try {
    for (const file of files) {
      const filePath = path.join(projectId, "comments", `${randomUUID()}${file.extension}`);
      const absolute = resolveStoredPath(filePath);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, file.bytes);
      rows.push({ fileName: file.fileName, filePath, fileSize: file.bytes.length, mimeType: file.mimeType });
    }
  } catch (error) {
    await discard();
    throw error;
  }
  return { rows, discard };
}

/**
 * Save a post with its files: the files go to disk first, their rows with
 * the post — and should the post fail, the files are taken away again.
 */
export async function withFiles<T>(
  projectId: string,
  files: PreparedFile[],
  save: (rows: Awaited<ReturnType<typeof storeCommentFiles>>["rows"]) => Promise<T>,
): Promise<T> {
  if (files.length === 0) return save([]);
  const { rows, discard } = await storeCommentFiles(projectId, files);
  try {
    return await save(rows);
  } catch (error) {
    await discard();
    throw error;
  }
}

/** Take a withdrawn post's files away: rows and bytes. */
export async function deleteCommentAttachments(commentId: string) {
  const attachments = await prisma.attachment.findMany({
    where: { commentId },
    select: { filePath: true },
  });
  if (attachments.length === 0) return;
  await prisma.attachment.deleteMany({ where: { commentId } });
  await Promise.all(attachments.map((a) => unlink(resolveStoredPath(a.filePath)).catch(() => {})));
}

/** Whether a stored type is safe to show in the browser rather than download. */
export function opensInline(mimeType: string) {
  return (
    ALLOWED_UPLOAD_MIME_TYPES.includes(mimeType as never) ||
    mimeType === "application/pdf" ||
    mimeType === "text/plain"
  );
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
 * Attach an automated run's screenshots and video to the result it recorded,
 * so the case's history shows them like a tester's own.
 *
 * Copied, not shared: deleting an attachment deletes its file, and that must
 * never take the run's own evidence with it. A file gone from disk is skipped.
 */
export async function attachRunEvidence(
  executionId: string,
  projectId: string,
  files: { path: string; fileName: string; mimeType: string; size: number }[],
) {
  let attached = 0;
  for (const file of files) {
    if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.mimeType as never)) continue;
    const relativePath = path.join(projectId, executionId, `${randomUUID()}${EXTENSION_BY_MIME[file.mimeType] ?? ".bin"}`);
    const target = resolveStoredPath(relativePath);
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(resolveStoredPath(file.path), target);
    } catch {
      continue;
    }
    await prisma.attachment.create({
      data: {
        executionId,
        fileName: safeDisplayName(file.fileName),
        filePath: relativePath,
        fileSize: file.size,
        mimeType: file.mimeType,
      },
    });
    attached += 1;
  }
  return attached;
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
