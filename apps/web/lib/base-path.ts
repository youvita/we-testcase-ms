/**
 * Prefix a same-origin app path with Next.js `basePath` (e.g. `/cases`).
 *
 * `next/link` and `redirect()` do this automatically. Raw `fetch("/api/…")`
 * and `<a href="/api/…">` do not — those must go through this helper when the
 * app is served under a shared Cloudflare / nginx path prefix.
 */
export function withBasePath(path: string): string {
  const raw = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim();
  if (!raw || raw === "/") return path;
  const base = raw.startsWith("/") ? raw.replace(/\/$/, "") : `/${raw.replace(/\/$/, "")}`;

  if (!path.startsWith("/")) return path;
  if (path === base || path.startsWith(`${base}/`)) return path;
  return `${base}${path}`;
}
