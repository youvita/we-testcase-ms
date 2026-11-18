/**
 * The address people reach the app at, for links sent outside it (Telegram).
 *
 * A fixed one is set in NEXT_PUBLIC_APP_URL or BETTER_AUTH_URL. On a free
 * Cloudflare tunnel there is none to set — its *.trycloudflare.com address
 * changes whenever the tunnel restarts — so the app remembers the address
 * people's own requests came in on, and links use the latest.
 *
 * Only a public name counts: the runner's calls (http://app:3000), localhost
 * and bare IPs would make links nobody else can open.
 */

let remembered: string | null = null;

export function isPublicHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "").toLowerCase();
  if (!name.includes(".") || name === "localhost" || name.endsWith(".localhost")) return false;
  // IPv4 or IPv6 literals.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.includes(":") || name.startsWith("[")) return false;
  return /^[a-z0-9.-]+$/.test(name);
}

/** Note the address a request came in on, when it is a public one. */
export function rememberPublicOrigin(headers: Headers): void {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]!.trim();
  if (!host || !isPublicHost(host)) return;
  const proto = (headers.get("x-forwarded-proto") ?? "https").split(",")[0]!.trim();
  remembered = `${proto === "http" ? "http" : "https"}://${host}`;
}

/** A configured address, if it is a public one: a local one makes no link for anyone else. */
export function publicUrlOrNull(value: string | undefined): string | null {
  const url = value?.trim().replace(/\/$/, "");
  if (!url) return null;
  try {
    return isPublicHost(new URL(url).host) ? url : null;
  } catch {
    return null;
  }
}

/** The latest public address requests came in on, if any yet. */
export function rememberedPublicOrigin(): string | null {
  return remembered;
}
