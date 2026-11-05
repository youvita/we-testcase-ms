import { badRequest } from "@/lib/api";
import { excelDocumentText } from "@/utils/excel-document";
import { openApiToMarkdown, parseOpenApi } from "@/utils/openapi-markdown";
import { parsePostmanCollection, postmanToMarkdown } from "@/utils/postman-markdown";

/**
 * Plain text from an uploaded requirements document.
 *
 * Headings are kept as Markdown `#` lines wherever the format has them (DOCX,
 * HTML, Markdown): extraction splits long documents at headings, and a
 * requirement's section comes from them.
 */

export const REQUIREMENT_DOC_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".md",
  ".markdown",
  ".txt",
  ".html",
  ".htm",
  // Swagger / OpenAPI specs and Postman collections, converted to one
  // section per endpoint.
  ".json",
  ".yaml",
  ".yml",
  // Spreadsheets: a requirements list, or an API spec laid out in columns.
  ".xlsx",
  ".xls",
  ".csv",
] as const;

export async function extractDocumentText(file: {
  buffer: Buffer;
  fileName: string;
}): Promise<string> {
  const extension = file.fileName
    .slice(file.fileName.lastIndexOf("."))
    .toLowerCase();

  let text: string;
  switch (extension) {
    case ".pdf": {
      const { extractText } = await import("unpdf");
      try {
        const result = await extractText(new Uint8Array(file.buffer), {
          mergePages: true,
        });
        text = result.text;
      } catch {
        throw badRequest("Could not read that PDF. Is it password-protected?");
      }
      break;
    }
    case ".docx": {
      const mammoth = await import("mammoth");
      try {
        const result = await mammoth.convertToHtml({ buffer: file.buffer });
        text = htmlToText(result.value);
      } catch {
        throw badRequest("Could not read that Word document.");
      }
      break;
    }
    case ".html":
    case ".htm":
      text = htmlToText(file.buffer.toString("utf8"));
      break;
    case ".md":
    case ".markdown":
    case ".txt":
      text = file.buffer.toString("utf8");
      break;
    case ".xlsx":
    case ".xls":
    case ".csv":
      try {
        text = excelDocumentText(file.buffer, file.fileName);
      } catch {
        throw badRequest("Could not read that spreadsheet. Save it as .xlsx and try again.");
      }
      break;
    case ".json":
    case ".yaml":
    case ".yml": {
      const spec = readSpec(file.buffer.toString("utf8"));
      if (!spec) {
        throw badRequest(
          "JSON and YAML files are read as a Swagger / OpenAPI spec or a Postman collection (v2.1), and this is neither.",
        );
      }
      return spec;
    }
    default:
      throw badRequest(
        `Unsupported file type "${extension || "unknown"}". Upload ${REQUIREMENT_DOC_EXTENSIONS.join(", ")}.`,
      );
  }

  const normalized = normalizeText(text);
  if (normalized.length < 50) {
    throw badRequest(
      extension === ".pdf"
        ? "That PDF has almost no text — a scanned PDF needs OCR first."
        : "That document has almost no text in it.",
    );
  }
  return normalized;
}

/**
 * Pasted document text: a pasted Swagger / OpenAPI spec or Postman collection
 * is converted the same way as an uploaded one, anything else is kept as it is.
 */
export function pastedDocumentText(text: string): string {
  try {
    return readSpec(text) ?? normalizeText(text);
  } catch (error) {
    // Prose that only mentions "openapi: 3" is still prose; text that starts
    // like a spec and does not parse is a broken spec, worth saying so.
    if (/^\s*(\{|["']?(openapi|swagger)["']?\s*:)/.test(text)) throw error;
    return normalizeText(text);
  }
}

/** The spec or collection as Markdown, null when the text is neither. */
function readSpec(source: string): string | null {
  try {
    const spec = parseOpenApi(source);
    if (spec) return normalizeText(openApiToMarkdown(spec));
    const collection = parsePostmanCollection(source);
    if (collection) return normalizeText(postmanToMarkdown(collection));
    return null;
  } catch (error) {
    throw badRequest((error as Error).message);
  }
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Just enough HTML-to-text for specs: headings, lists, tables, paragraphs. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])[^>]*>/gi, (_m, level: string) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|table|ul|ol)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
      return ENTITIES[entity.toLowerCase()] ?? match;
    });
}

/**
 * Split a long document into parts of at most `maxChars`, preferring to cut
 * at a heading, then at a blank line, so a requirement is rarely torn in two.
 */
export function splitDocument(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const floor = Math.floor(maxChars * 0.5);
    // The first boundary that leaves a part at least half full.
    const cut =
      [
        window.lastIndexOf("\n#"),
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
      ].find((index) => index > floor) ?? maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}
