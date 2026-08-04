import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { badRequest, notFound } from "@/lib/api";
import { ALLOWED_IMAGE_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";

/**
 * Avatars live outside /public and are served through /api/avatars/[userId]
 * so access stays behind a session check. One file per user under
 * avatars/{userId}/ — uploading replaces whatever was there.
 */
function uploadRoot() {
  const configured = process.env.UPLOAD_DIR ?? "./uploads";
  return path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured);
}

function avatarDir(userId: string) {
  // Refuse path segments that could escape the avatars root.
  if (!userId || userId.includes("..") || userId.includes("/") || userId.includes("\\")) {
    throw badRequest("Invalid user id");
  }
  return path.join(uploadRoot(), "avatars", userId);
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Magic-number check — never trust the browser-supplied MIME type. */
function sniffImageMime(buffer: Buffer): string | null {
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
  if (
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

async function clearAvatarDir(userId: string) {
  const dir = avatarDir(userId);
  try {
    const files = await readdir(dir);
    await Promise.all(
      files.map((file) => unlink(path.join(dir, file)).catch(() => undefined)),
    );
  } catch {
    // Directory may not exist yet.
  }
}

async function findAvatarFile(userId: string) {
  const dir = avatarDir(userId);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  const file = files.find((name) => {
    const ext = path.extname(name).toLowerCase();
    return Boolean(MIME_BY_EXTENSION[ext]);
  });
  if (!file) return null;

  const absolutePath = path.join(dir, file);
  const mimeType = MIME_BY_EXTENSION[path.extname(file).toLowerCase()]!;
  return { absolutePath, mimeType, fileName: file };
}

/** Stable URL with a cache-buster so browsers pick up a replacement. */
export function avatarUrl(userId: string, version: number | string = Date.now()) {
  return `/api/avatars/${userId}?v=${version}`;
}

export async function saveAvatar(
  userId: string,
  file: { name: string; bytes: Buffer },
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw notFound("User");

  if (file.bytes.length === 0) throw badRequest("The file is empty");

  const sniffed = sniffImageMime(file.bytes);
  if (!sniffed || !ALLOWED_IMAGE_MIME_TYPES.includes(sniffed as never)) {
    throw badRequest("Only PNG, JPEG, GIF and WebP images are supported");
  }

  if (file.bytes.length > MAX_UPLOAD_BYTES) {
    throw badRequest(
      `Profile pictures must be ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB or smaller`,
    );
  }

  const extension = EXTENSION_BY_MIME[sniffed] ?? ".bin";
  const dir = avatarDir(userId);
  await mkdir(dir, { recursive: true });
  await clearAvatarDir(userId);

  const absolutePath = path.join(dir, `avatar${extension}`);
  await writeFile(absolutePath, file.bytes);

  const image = avatarUrl(userId, randomUUID().slice(0, 8));
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { image },
    select: { id: true, name: true, email: true, image: true },
  });

  return updated;
}

export async function removeAvatar(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw notFound("User");

  await clearAvatarDir(userId);

  return prisma.user.update({
    where: { id: userId },
    data: { image: null },
    select: { id: true, name: true, email: true, image: true },
  });
}

export async function statAvatar(userId: string) {
  const file = await findAvatarFile(userId);
  if (!file) throw notFound("Avatar");

  try {
    const { size } = await stat(file.absolutePath);
    return { ...file, size };
  } catch {
    throw notFound("Avatar");
  }
}

export async function readAvatarBytes(absolutePath: string) {
  try {
    return await readFile(absolutePath);
  } catch {
    throw notFound("Avatar");
  }
}

export function avatarETag(userId: string, size: number) {
  return `W/"${createHash("sha1").update(`${userId}:${size}`).digest("hex")}"`;
}
