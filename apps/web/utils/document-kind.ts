import type { RequirementDocKind } from "@wetestcase/dto";

/**
 * Which kind of requirements document this is, when the uploader did not
 * say: an API spec is Other; a PRD or an FRD names itself in its title, its
 * file name or its opening; anything else is Other.
 *
 * The kind matters: a PRD is product background and is not read into
 * requirements; an FRD or Other is.
 */

const PRD = /\bPRD\b|\bproduct[\s-]+requirements?\b/i;
// A PRD often has a "Non-functional requirements" section: not an FRD.
const FRD = /\bFRD\b|(?<!non[-\s]?)\bfunctional[\s-]+(requirements?|spec(ification)?s?)\b/i;

/** How much of the opening is read: the title page and the contents. */
const OPENING_CHARS = 2000;

/** Which kind the text names first, or null when it names neither. */
function named(text: string): RequirementDocKind | null {
  const prd = text.search(PRD);
  const frd = text.search(FRD);
  if (prd < 0 && frd < 0) return null;
  if (frd < 0) return "PRD";
  if (prd < 0) return "FRD";
  return prd < frd ? "PRD" : "FRD";
}

export function detectDocKind(doc: {
  title?: string | null;
  fileName?: string | null;
  content: string;
}): RequirementDocKind {
  // Swagger / OpenAPI and Postman: by file, or by the reference they are
  // converted into.
  if (doc.fileName && /\.(json|ya?ml)$/i.test(doc.fileName)) return "OTHER";
  const firstLine = doc.content.trimStart().split("\n", 1)[0] ?? "";
  if (/^#\s.*— API reference\s*$/.test(firstLine)) return "OTHER";

  // What the uploader called it outweighs what the text says.
  const name = [doc.title, doc.fileName?.replace(/\.[^.]+$/, "")].filter(Boolean).join(" ");
  return named(name.replace(/[_.]+/g, " ")) ?? named(doc.content.slice(0, OPENING_CHARS)) ?? "OTHER";
}
