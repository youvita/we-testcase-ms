import * as XLSX from "xlsx";

import {
  API_SPEC_MARKER,
  basePathNote,
  commonBasePath,
  operationCode,
  relativePath,
} from "@/utils/openapi-markdown";
import { maskedJson } from "@/utils/postman-markdown";

/**
 * A spreadsheet of requirements, as a requirements document.
 *
 * Every visible sheet becomes a `##` section. A table — a header row and rows
 * under it — is written row by row as "Column: value" lines; a form-like
 * sheet (labels and values scattered across cells) line by line, its cells
 * joined with "|".
 *
 * API specs are recognised in two layouts, often together: an index table
 * with a Method column and a URL / Endpoint / Path column (group rows such as
 * "Authentication" between the endpoints), and one sheet per endpoint that
 * states its Method and URL as labelled cells. Each endpoint becomes one `###`
 * section, as in a converted OpenAPI spec, with its detail sheet folded in.
 *
 * Sample JSON keeps its shape with secret-looking fields hidden, and anything
 * shaped like a JWT is hidden wherever it appears.
 */

type Cell = string;
type Row = { row: number; cells: Cell[] };
type Sheet = { name: string; rows: Row[] };

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"]);
const METHOD_HEADER = /^(http |request )?(method|verb)$/;
const PATH_HEADER = /(^| )(url|uri|endpoint|end point|path|route)$|^apis?$/;
const NAME_HEADER = /(^| )(name|title|summary|feature|function|operation)$/;
/** How far down a sheet its header row, or a detail sheet's Method and URL, are looked for. */
const SEARCH_ROWS = 20;
const JWT = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g;
const MORE_ROWS = "More rows for this endpoint:";
/** Link cells ("GO", "<= GO") that only jump between sheets. */
const NAVIGATION = /^(<=?\s*)?go(\s*=?>)?$/i;

type Endpoint = {
  method: string;
  path: string;
  title: string;
  group: string;
  /** "Column: value" lines from the index table. */
  fields: string[];
  /** The endpoint's own sheet, when it has one. */
  detail: { sheet: string; lines: string[] } | null;
};

export function excelDocumentText(buffer: Buffer, fileName: string): string {
  const sheets = readWorkbook(buffer, fileName);

  // Endpoints from index tables first, then each detail sheet joins its
  // endpoint — matched by method and path, else by name — or adds one.
  const endpoints: Endpoint[] = [];
  const indexes = new Map<string, { preamble: string[]; table: Table | null }>();
  const details: { sheet: Sheet; endpoint: Endpoint }[] = [];
  const others: Sheet[] = [];
  for (const sheet of sheets) {
    const detail = readDetailSheet(sheet);
    if (detail) {
      details.push({ sheet, endpoint: detail });
      continue;
    }
    const table = readTable(sheet);
    if (table?.endpoints.length) {
      endpoints.push(...table.endpoints);
      indexes.set(sheet.name, { preamble: table.preamble, table });
    } else {
      others.push(sheet);
    }
  }
  const standalone: Endpoint[] = [];
  for (const { sheet, endpoint } of details) {
    const match =
      endpoints.find((e) => e.method === endpoint.method && samePath(e.path, endpoint.path)) ??
      endpoints.find((e) => sameName(e.title, endpoint.title) || sameName(e.title, sheet.name));
    if (match) match.detail = endpoint.detail;
    else standalone.push({ ...endpoint, group: sheet.name });
  }

  const all = [...endpoints, ...standalone];
  const base = commonBasePath(all.map((endpoint) => endpoint.path));
  const codes = new Map<Endpoint, string>();
  for (const endpoint of all) {
    let code = operationCode(endpoint.method, relativePath(endpoint.path, base));
    if ([...codes.values()].includes(code)) code = `${code} (${endpoint.title || endpoint.group})`;
    codes.set(endpoint, code);
  }

  const out: string[] = [];
  if (all.length) {
    out.push(
      API_SPEC_MARKER,
      "",
      "Converted from a spreadsheet. Each `###` section is one endpoint; its Identifier is the method and the path below the base path.",
    );
    if (base) out.push("", basePathNote(base));
  }

  for (const sheet of sheets) {
    const index = indexes.get(sheet.name);
    if (index) {
      out.push("", `## ${sheet.name}`);
      if (index.preamble.length) out.push("", ...index.preamble);
      let group = "";
      for (const endpoint of index.table!.endpoints) {
        if (endpoint.group && endpoint.group !== group) {
          group = endpoint.group;
          out.push("", `## ${group}`);
        }
        out.push("", ...endpointLines(codes.get(endpoint)!, endpoint));
      }
      if (index.table!.records.length) out.push("", ...recordLines(index.table!));
      continue;
    }
    const own = standalone.find((endpoint) => endpoint.group === sheet.name);
    if (own) {
      out.push("", `## ${sheet.name}`, "", ...endpointLines(codes.get(own)!, own));
      continue;
    }
    if (!others.includes(sheet)) continue; // a detail sheet, already in its endpoint
    const table = readTable(sheet);
    const lines = table ? [...table.preamble, ...(table.preamble.length ? [""] : []), ...recordLines(table)] : formLines(sheet.rows);
    if (lines.length) out.push("", `## ${sheet.name}`, "", ...lines);
  }
  return out.join("\n").replace(JWT, "<hidden>").trim();
}

function readWorkbook(buffer: Buffer, fileName: string): Sheet[] {
  const workbook = fileName.toLowerCase().endsWith(".csv")
    ? // As text, so UTF-8 survives — Khmer, Thai and the like.
      XLSX.read(buffer.toString("utf8"), { type: "string", raw: true })
    : XLSX.read(buffer, { type: "buffer", cellDates: true });
  const hidden = new Set(
    (workbook.Workbook?.Sheets ?? []).filter((sheet) => sheet.Hidden).map((sheet) => sheet.name),
  );
  return workbook.SheetNames.filter((name) => !hidden.has(name)).map((name) => {
    const sheet = workbook.Sheets[name]!;
    // Blank rows kept, and the used range's first row added, so "Row 5" is
    // row 5 in Excel too.
    const firstRow = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).s.r + 1 : 1;
    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: true })
      .map((cells, i) => ({
        row: firstRow + i,
        cells: cells.map((cell) => {
          const value = String(cell ?? "").trim();
          return NAVIGATION.test(value) ? "" : value;
        }),
      }));
    return { name, rows };
  });
}

const filled = (cells: Cell[]) => cells.filter(Boolean);
const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();

/**
 * A sheet about one endpoint: labelled cells near the top give its method and
 * URL ("Method | POST", "URL | https://…/auth/token").
 */
function readDetailSheet(sheet: Sheet): Endpoint | null {
  const labelled = (pattern: RegExp) => {
    for (const { cells } of sheet.rows.slice(0, SEARCH_ROWS)) {
      const values = filled(cells);
      const at = values.findIndex((value) => pattern.test(normalize(value)));
      if (at >= 0 && values[at + 1]) return values[at + 1]!;
    }
    return "";
  };
  const method = labelled(METHOD_HEADER).toUpperCase();
  const path = cleanPath(labelled(PATH_HEADER));
  if (!HTTP_METHODS.has(method) || !path) return null;
  return {
    method,
    path,
    title: labelled(/^(task |api |apis )?name$|^title$/) || sheet.name,
    group: "",
    fields: [],
    detail: { sheet: sheet.name, lines: formLines(sheet.rows) },
  };
}

type Table = {
  header: string[];
  preamble: string[];
  records: Row[];
  endpoints: Endpoint[];
};

/**
 * A header row and rows under it, or null for a form-like sheet. A header
 * fills at least half the columns the sheet uses; a form's label rows do not.
 */
function readTable(sheet: Sheet): Table | null {
  const used = new Set<number>();
  for (const { cells } of sheet.rows) cells.forEach((cell, i) => cell && used.add(i));
  const headerIndex = sheet.rows
    .slice(0, SEARCH_ROWS)
    .findIndex(({ cells }) => filled(cells).length >= Math.max(2, used.size / 2));
  if (headerIndex === -1) return null;

  const width = Math.max(...used) + 1;
  const headerCells = sheet.rows[headerIndex]!.cells;
  const header = Array.from({ length: width }, (_, i) => headerCells[i] || `Column ${i + 1}`);
  const preamble = sheet.rows.slice(0, headerIndex).map(({ cells }) => filled(cells).join(" ")).filter(Boolean);
  const body = sheet.rows.slice(headerIndex + 1).filter(({ cells }) => filled(cells).length);

  const names = header.map(normalize);
  const methodColumn = names.findIndex((name) => METHOD_HEADER.test(name));
  const pathColumn = names.findIndex((name) => PATH_HEADER.test(name));
  if (methodColumn === -1 || pathColumn === -1) return { header, preamble, records: body, endpoints: [] };

  const nameColumn = names.findIndex((name) => NAME_HEADER.test(name));
  const skip = [methodColumn, pathColumn, nameColumn];
  const endpoints: Endpoint[] = [];
  const records: Row[] = [];
  let group = "";
  let current: Endpoint | null = null;
  for (const record of body) {
    const method = record.cells[methodColumn]!.toUpperCase();
    const path = cleanPath(record.cells[pathColumn]!);
    if (HTTP_METHODS.has(method) && path) {
      current = {
        method,
        path,
        title: (nameColumn >= 0 && record.cells[nameColumn]) || "",
        group,
        fields: fieldLines(header, record.cells, skip, true),
        detail: null,
      };
      endpoints.push(current);
    } else if (!record.cells[methodColumn] && !record.cells[pathColumn] && filled(record.cells).length === 1) {
      // A row holding only a name between endpoints: the group they belong to.
      group = filled(record.cells)[0]!;
      current = null;
    } else if (!record.cells[methodColumn] && !record.cells[pathColumn] && current) {
      // The endpoint above, continued: a parameter or a response per row.
      const fields = header
        .map((name, i) => (record.cells[i] && !skip.includes(i) ? `${name}: ${oneLine(record.cells[i]!)}` : ""))
        .filter(Boolean);
      if (!current.fields.includes(MORE_ROWS)) current.fields.push("", MORE_ROWS);
      current.fields.push(`- ${fields.join(" · ")}`);
    } else {
      records.push(record);
    }
  }
  return { header, preamble, records, endpoints };
}

function endpointLines(code: string, endpoint: Endpoint): string[] {
  const lines = [
    `### ${code}${endpoint.title ? ` — ${endpoint.title}` : ""}`,
    `Identifier: ${code}`,
    `Endpoint: ${operationCode(endpoint.method, endpoint.path)}`,
    ...endpoint.fields,
  ];
  if (endpoint.detail) {
    lines.push("", `From the "${endpoint.detail.sheet}" sheet:`, ...endpoint.detail.lines);
  }
  return lines;
}

function recordLines(table: Table): string[] {
  const used = table.header.filter((_, i) => table.records.some(({ cells }) => cells[i]));
  if (!table.records.length) return [];
  const lines = [`Columns: ${used.join(", ")}`];
  for (const record of table.records) {
    lines.push("", `Row ${record.row}:`, ...fieldLines(table.header, record.cells));
  }
  return lines;
}

/** "- Column: value" for each filled cell; a multi-line value stays indented under it. */
function fieldLines(header: string[], cells: Cell[], skip: number[] = [], numbered = false): string[] {
  return header.flatMap((name, i) => {
    const value = cells[i];
    if (!value || skip.includes(i)) return [];
    // A table's running number ("No.: 3") says nothing about the endpoint.
    if (numbered && /^\d+$/.test(value) && /^(no|#|n o|number|seq)$/.test(normalize(name) || "#")) return [];
    const [head, ...more] = value.split(/\r?\n/);
    return [`- ${name}: ${head}`, ...more.map((line) => `  ${line}`)];
  });
}

/** A form-like sheet line by line; sample JSON in a code block, its secrets hidden. */
function formLines(rows: Row[]): string[] {
  const lines: string[] = [];
  for (const { cells } of rows) {
    const values = filled(cells);
    if (!values.length) continue;
    const json = values.length === 1 && /^[[{]/.test(values[0]!) ? maskedJson(values[0]!) : null;
    if (json) {
      lines.push("```json", ...json.split("\n"), "```");
      continue;
    }
    lines.push(`- ${values.map(oneLine).join(" | ")}`);
  }
  return lines;
}

/** "/customers/{id}" from a cell: no host, query, method or Postman syntax. */
function cleanPath(value: string): string {
  let path = value
    .replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\{\{[^}]+\}\}/, "")
    .replace(/^[a-z]+:\/\/[^/]+/i, "")
    .trim();
  if (!path || /\s/.test(path)) return "";
  if (!path.startsWith("/")) path = `/${path}`;
  return path.replace(/\/:([\w-]+)/g, "/{$1}").replace(/\/+$/, "") || "/";
}

const samePath = (a: string, b: string) => a === b || a.endsWith(b) || b.endsWith(a);
const sameName = (a: string, b: string) => Boolean(a && b) && normalize(a) === normalize(b);
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
