/**
 * The username to show: as the person typed it (`displayUsername`), unless
 * that copy is stale — it must be the same name, differing only in case —
 * else the real one, which is what sign-in uses.
 */
export function shownUsername(
  username: string | null | undefined,
  displayUsername: string | null | undefined,
): string | null {
  if (!username) return null;
  return displayUsername && displayUsername.toLowerCase() === username ? displayUsername : username;
}
