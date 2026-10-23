import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Symmetric encryption for secrets kept at rest — today, people's Claude
 * subscription tokens.
 *
 * AES-256-GCM, so a tampered value fails to open rather than decrypting to
 * garbage. The key is derived from `CLAUDE_TOKEN_SECRET` when set, else from
 * `BETTER_AUTH_SECRET`, so a deployment needs no new setting. Rotating
 * whichever one is in use makes every stored token unreadable; people then
 * reconnect, which is the only consequence.
 *
 * Stored form: `v1:<iv>:<tag>:<ciphertext>`, each part base64.
 */

const VERSION = "v1";

function key(): Buffer {
  const secret = process.env.CLAUDE_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("Set BETTER_AUTH_SECRET (or CLAUDE_TOKEN_SECRET) to store tokens");
  }
  // A label keeps this key distinct from anything else derived from the
  // auth secret.
  return createHash("sha256").update(`wetestcase:secret-box:${secret}`).digest();
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(":");
}

/** Null when the value cannot be opened — wrong key, or not ours. */
export function open(sealed: string): string | null {
  const [version, iv, tag, ciphertext] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
