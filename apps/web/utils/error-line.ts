/**
 * Which line of a script an automated failure points at.
 *
 * Playwright's error carries a code frame whose failing line is marked with
 * ">" — `> 63 | await expect(row).toContainText("Non-Taxable");`. The line is
 * found by its text, not its number: older runs numbered lines from the top
 * of the runner's generated file rather than the script, and the text is
 * right either way. The number is the fallback when the text is not unique.
 */
export function findErrorLine(
  code: string,
  error: string | null | undefined,
  /** Only trust the text: for a script that is not the one that ran. */
  options: { textOnly?: boolean } = {},
): number | null {
  if (!error) return null;
  const marked = /^\s*>\s*(\d+)\s*\|\s?(.*)$/m.exec(error);
  if (!marked) return null;
  const markedNumber = Number(marked[1]);
  const markedText = (marked[2] ?? "").trim();

  const lines = code.split("\n");
  if (markedText) {
    const matches = lines
      .map((line, index) => (line.trim() === markedText ? index + 1 : null))
      .filter((n): n is number => n !== null);
    if (matches.length === 1) return matches[0]!;
    // Several identical lines: the one the number points at, if it is one.
    if (matches.includes(markedNumber)) return markedNumber;
    if (matches.length > 0) return matches[0]!;
  }
  if (options.textOnly) return null;
  return markedNumber >= 1 && markedNumber <= lines.length ? markedNumber : null;
}

/** The first line of an error, for a one-line summary. */
export function errorHeadline(error: string | null | undefined): string {
  return (error ?? "").split("\n").find((line) => line.trim())?.trim() ?? "";
}
