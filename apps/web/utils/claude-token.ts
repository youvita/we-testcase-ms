/**
 * The token out of whatever was pasted. A token is too long for one terminal
 * line, and copying it wrapped brings line breaks into the middle of it —
 * Windows' console also pads each line with spaces to the window's width —
 * while a selection that started early brings the text around it.
 *
 * So: from where "sk-ant-" starts, the token runs on through every following
 * line that is nothing but token characters (letters, digits, "-", "_"). A
 * blank line, or text with spaces in it, ends it.
 */
export function normalizeToken(raw: string): string {
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  const first = lines.findIndex((line) => line.includes("sk-ant-"));
  if (first === -1) return raw.replace(/\s+/g, "");

  const start = /sk-ant-[\w-]*/.exec(lines[first]!)!;
  let token = start[0];
  // Only a token that runs to the end of its line can continue on the next.
  if (start.index + token.length === lines[first]!.length) {
    for (const line of lines.slice(first + 1)) {
      if (!/^[\w-]+$/.test(line)) break;
      token += line;
    }
  }
  return token;
}
