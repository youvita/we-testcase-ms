import * as XLSX from "xlsx";

import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/api";
import {
  PLATFORMS,
  PLATFORM_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  TEST_TYPES,
  TEST_TYPE_LABELS,
} from "@/lib/constants";
import type { ImportPreview, ImportRowError, ImportSummary } from "@/types";
import {
  cellToString,
  isRowEmpty,
  mapHeaders,
  parsePlatform,
  parsePriority,
  parseTestType,
  type CanonicalField,
} from "@/utils/excel";

import {
  withHiddenSheets,
  withListValidations,
  withSheetStyles,
} from "@/utils/xlsx-format";

import { assertProjectExists } from "./project.service";

/** Hidden sheet backing the Module dropdown in the template. */
const MODULE_LIST_SHEET = "Lists";

/** Rows past this point are rejected outright to keep a request bounded. */
const MAX_ROWS = 5000;

export type ImportMode = "skip" | "update";

type ParsedRow = {
  /** 1-based row number in the sheet, header included, for error reporting. */
  row: number;
  tcId: string;
  module: string;
  title: string;
  preconditions: string;
  steps: string;
  expectedResult: string;
  testType: ReturnType<typeof parseTestType>;
  priority: ReturnType<typeof parsePriority>;
  platform: ReturnType<typeof parsePlatform>;
};

/**
 * Parse an uploaded workbook into rows, without touching the database.
 *
 * Split out from `importTestCases` so it can back a "preview before import"
 * step later without duplicating the parsing rules.
 */
export function parseWorkbook(buffer: Buffer): {
  sheetName: string;
  rows: ParsedRow[];
  errors: ImportRowError[];
  skippedEmpty: number;
  rowsRead: number;
  mappedColumns: Record<string, string>;
  unmappedColumns: string[];
} {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw badRequest(
      "That file could not be read as a spreadsheet. Save it as .xlsx and try again.",
    );
  }

  if (workbook.SheetNames.length === 0) throw badRequest("The workbook has no sheets");

  // Workbooks often carry extra sheets (an "Info"/instructions tab, a hidden
  // dropdown-source sheet) alongside the actual data. Scan every sheet and
  // prefer the first one whose header row maps a title column, instead of
  // assuming the data lives on SheetNames[0].
  let sheetName: string | null = null;
  let matrix: unknown[][] = [];
  let headerIndex = -1;
  let headerInfo: ReturnType<typeof mapHeaders> | null = null;

  let fallback: {
    sheetName: string;
    matrix: unknown[][];
    headerIndex: number;
    headerInfo: ReturnType<typeof mapHeaders>;
  } | null = null;

  for (const candidateSheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[candidateSheetName];
    if (!sheet) continue;

    // header:1 gives raw rows so we can locate the header row ourselves — many
    // real templates carry a title/logo row above the actual headings.
    const candidateMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });

    // Find the first row that maps at least a TC ID or a title — that's the header.
    for (let i = 0; i < Math.min(candidateMatrix.length, 20); i += 1) {
      const candidateRow = (candidateMatrix[i] ?? []).map((c) => cellToString(c));
      if (candidateRow.every((c) => c === "")) continue;

      const info = mapHeaders(candidateRow);
      if (info.mapping.tcId !== undefined || info.mapping.title !== undefined) {
        if (info.mapping.title !== undefined) {
          sheetName = candidateSheetName;
          matrix = candidateMatrix;
          headerIndex = i;
          headerInfo = info;
        } else if (!fallback) {
          fallback = { sheetName: candidateSheetName, matrix: candidateMatrix, headerIndex: i, headerInfo: info };
        }
        break;
      }
    }

    if (headerInfo) break;
  }

  if (!headerInfo && fallback) {
    ({ sheetName, matrix, headerIndex, headerInfo } = fallback);
  }

  if (!sheetName || headerIndex === -1 || !headerInfo) {
    throw badRequest(
      "Could not find a header row. The sheet needs a column for the test case ID or the test case description.",
    );
  }

  const { mapping, mappedColumns, unmappedColumns } = headerInfo;
  if (mapping.title === undefined) {
    throw badRequest(
      'No test case description column was found. Add a column named "Test Case" or "Description".',
    );
  }

  const dataRows = matrix.slice(headerIndex + 1);
  if (dataRows.length > MAX_ROWS) {
    throw badRequest(
      `That sheet has ${dataRows.length} rows, above the ${MAX_ROWS}-row limit. Split it into smaller files.`,
    );
  }

  const read = (cells: unknown[], field: CanonicalField): string => {
    const index = mapping[field];
    if (index === undefined) return "";
    return cellToString(cells[index]);
  };

  const rows: ParsedRow[] = [];
  const errors: ImportRowError[] = [];
  let skippedEmpty = 0;
  let autoIdCounter = 0;

  dataRows.forEach((cells, offset) => {
    // +2 converts to a spreadsheet row number: +1 for zero-index, +1 for header.
    const rowNumber = headerIndex + offset + 2;
    const row = cells ?? [];

    const relevant = Object.values(mapping)
      .filter((i): i is number => i !== undefined)
      .map((i) => row[i]);

    if (isRowEmpty(relevant)) {
      skippedEmpty += 1;
      return;
    }

    const title = read(row, "title");
    if (!title) {
      errors.push({
        row: rowNumber,
        tcId: read(row, "tcId") || null,
        reason: "No test case description — row skipped",
      });
      return;
    }

    let tcId = read(row, "tcId");
    if (!tcId) {
      // A row with content but no ID still deserves to be imported; give it a
      // stable generated ID and tell the user in the summary.
      autoIdCounter += 1;
      tcId = `ROW-${rowNumber}`;
      errors.push({
        row: rowNumber,
        tcId,
        reason: `No TC ID in the sheet — imported as "${tcId}"`,
      });
    }

    rows.push({
      row: rowNumber,
      tcId,
      module: read(row, "module") || "Unassigned",
      title,
      preconditions: read(row, "preconditions"),
      steps: read(row, "steps"),
      expectedResult: read(row, "expectedResult"),
      testType: parseTestType(read(row, "testType")),
      priority: parsePriority(read(row, "priority")),
      platform: parsePlatform(read(row, "platform")),
    });
  });

  return {
    sheetName,
    rows,
    errors,
    skippedEmpty,
    rowsRead: dataRows.length,
    mappedColumns,
    unmappedColumns,
  };
}

/**
 * Import parsed rows into a project.
 *
 * - Empty rows are skipped.
 * - A TC ID repeated *within the file* keeps its first occurrence.
 * - A TC ID that already exists *in the project* is either skipped or updated,
 *   per `mode`. Updating never touches execution history or the case status.
 * - Modules referenced by name are created on demand.
 *
 * The whole import runs in one transaction, so a failure leaves no partial data.
 */
export async function importTestCases(
  projectId: string,
  file: { buffer: Buffer; fileName: string },
  mode: ImportMode = "skip",
): Promise<ImportSummary> {
  await assertProjectExists(projectId);

  const parsed = parseWorkbook(file.buffer);
  const errors = [...parsed.errors];

  // Collapse duplicates inside the file, first occurrence wins.
  const seen = new Map<string, ParsedRow>();
  let duplicatesInFile = 0;
  for (const row of parsed.rows) {
    const key = row.tcId.toLowerCase();
    if (seen.has(key)) {
      duplicatesInFile += 1;
      errors.push({
        row: row.row,
        tcId: row.tcId,
        reason: `Duplicate TC ID "${row.tcId}" in the file — first occurrence kept`,
      });
      continue;
    }
    seen.set(key, row);
  }

  const rows = [...seen.values()];

  const existing = await prisma.testCase.findMany({
    where: { projectId, tcId: { in: rows.map((r) => r.tcId) } },
    select: { id: true, tcId: true },
  });
  const existingByTcId = new Map(existing.map((t) => [t.tcId, t.id]));

  const modulesCreated: string[] = [];
  let created = 0;
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    // Resolve every distinct module name up front.
    const moduleNames = [...new Set(rows.map((r) => r.module))];
    const moduleIdByName = new Map<string, string>();

    const startPosition = await tx.module.count({ where: { projectId } });

    for (const [index, name] of moduleNames.entries()) {
      const found = await tx.module.findUnique({
        where: { projectId_name: { projectId, name } },
        select: { id: true },
      });

      if (found) {
        moduleIdByName.set(name, found.id);
        continue;
      }

      const madeModule = await tx.module.create({
        data: { projectId, name, position: startPosition + index },
        select: { id: true },
      });
      moduleIdByName.set(name, madeModule.id);
      modulesCreated.push(name);
    }

    for (const row of rows) {
      const moduleId = moduleIdByName.get(row.module);
      if (!moduleId) continue; // unreachable; keeps the type narrow

      const existingId = existingByTcId.get(row.tcId);

      if (existingId) {
        if (mode === "skip") {
          errors.push({
            row: row.row,
            tcId: row.tcId,
            reason: `TC ID "${row.tcId}" already exists in this project — skipped`,
          });
          continue;
        }

        // Deliberately does not write `status` or `lastExecutedAt`: re-importing
        // a sheet must never wipe recorded results.
        await tx.testCase.update({
          where: { id: existingId },
          data: {
            moduleId,
            title: row.title,
            preconditions: row.preconditions || null,
            steps: row.steps || null,
            expectedResult: row.expectedResult || null,
            testType: row.testType,
            priority: row.priority,
            platform: row.platform,
          },
        });
        updated += 1;
        continue;
      }

      await tx.testCase.create({
        data: {
          projectId,
          moduleId,
          tcId: row.tcId,
          title: row.title,
          preconditions: row.preconditions || null,
          steps: row.steps || null,
          expectedResult: row.expectedResult || null,
          testType: row.testType,
          priority: row.priority,
          platform: row.platform,
        },
      });
      created += 1;
    }
  });

  return {
    fileName: file.fileName,
    sheetName: parsed.sheetName,
    rowsRead: parsed.rowsRead,
    created,
    updated,
    skippedEmpty: parsed.skippedEmpty,
    duplicatesInFile,
    modulesCreated,
    errors: errors.sort((a, b) => a.row - b.row),
    mappedColumns: parsed.mappedColumns,
    unmappedColumns: parsed.unmappedColumns,
  };
}

/**
 * Style indices appended to SheetJS's default `cellXfs` (index 0).
 * Community SheetJS does not write cell styles, so these are spliced in after
 * `XLSX.write` the same way dropdown validations are.
 */
/**
 * Coarse throughput used only for the "estimated time" line in the preview.
 *
 * Each row costs a lookup plus a write inside one transaction; this is the
 * observed order of magnitude, not a measurement of the user's machine, so the
 * figure is always presented as an approximation.
 */
const IMPORT_ROWS_PER_SECOND = 60;

/**
 * Parse an upload and report what importing it would do, without writing.
 *
 * Runs the same `parseWorkbook` the real import uses and checks TC IDs against
 * the project, so the counts shown before the click are the counts that happen
 * after it — no second set of rules to drift out of step.
 */
export async function previewImport(
  projectId: string,
  file: { buffer: Buffer; fileName: string },
): Promise<ImportPreview> {
  await assertProjectExists(projectId);

  const parsed = parseWorkbook(file.buffer);

  // Collapse duplicates inside the file exactly as the import does.
  const byTcId = new Map<string, ParsedRow>();
  let duplicatesInFile = 0;
  for (const row of parsed.rows) {
    const key = row.tcId.toLowerCase();
    if (byTcId.has(key)) {
      duplicatesInFile += 1;
      continue;
    }
    byTcId.set(key, row);
  }
  const rows = [...byTcId.values()];

  const [existing, projectModules] = await Promise.all([
    prisma.testCase.findMany({
      where: { projectId, tcId: { in: rows.map((row) => row.tcId) } },
      select: { tcId: true },
    }),
    prisma.module.findMany({ where: { projectId }, select: { name: true } }),
  ]);

  const existingTcIds = new Set(existing.map((row) => row.tcId));
  const known = new Set(projectModules.map((mod) => mod.name));
  const moduleNames = [...new Set(rows.map((row) => row.module))];

  const duplicates = rows.filter((row) => existingTcIds.has(row.tcId)).length;

  return {
    fileName: file.fileName,
    sheetName: parsed.sheetName,
    rowsRead: parsed.rowsRead,
    testCases: rows.length,
    modules: moduleNames.length,
    newModules: moduleNames.filter((name) => !known.has(name)).length,
    duplicates,
    duplicatesInFile,
    newCases: rows.length - duplicates,
    skippedEmpty: parsed.skippedEmpty,
    warnings: parsed.errors.length,
    unmappedColumns: parsed.unmappedColumns,
    estimatedSeconds: Math.max(
      1,
      Math.ceil(rows.length / IMPORT_ROWS_PER_SECOND),
    ),
  };
}

/** A downloadable template matching the documented column layout. */
export function buildImportTemplate(options?: {
  /** Existing project module names for the Module column dropdown. */
  modules?: string[];
}): Buffer {
  const headers = [
    "TC ID",
    "Module",
    "Test Case",
    "Preconditions",
    "Steps",
    "Expected Result",
    "Test Type",
    "Priority",
    "Platform",
  ];

  const rows = [
    headers,
    [
      "TC-LOGIN-001",
      "Login",
      "Sign in with valid credentials",
      "An active user account exists.",
      "1. Open the login page\n2. Enter email and password\n3. Click Sign in",
      "The user reaches the dashboard.",
      "Functional",
      "High",
      "Web",
    ],
    [
      "TC-LOGIN-002",
      "Login",
      "Reject an incorrect password",
      "An active user account exists.",
      "1. Enter a wrong password\n2. Submit",
      "An invalid-credentials message is shown.",
      "Negative",
      "Medium",
      "Android",
    ],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 16 },
    { wch: 14 },
    { wch: 40 },
    { wch: 30 },
    { wch: 44 },
    { wch: 36 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Test Cases");

  // Prefer project modules; fall back to the sample "Login" so the dropdown
  // still appears when the project has none yet. Import can still create new
  // module names typed by hand (warning-style validation).
  const moduleNames = [
    ...new Set(
      (options?.modules?.length ? options.modules : ["Login"])
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];

  const listsSheet = XLSX.utils.aoa_to_sheet(
    moduleNames.map((name) => [name]),
  );
  XLSX.utils.book_append_sheet(workbook, listsSheet, MODULE_LIST_SHEET);

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  const styled = withSheetStyles(buffer);
  const withListsHidden = withHiddenSheets(styled, [MODULE_LIST_SHEET]);

  const moduleCol = XLSX.utils.encode_col(headers.indexOf("Module"));
  const moduleRange = `${MODULE_LIST_SHEET}!$A$1:$A$${moduleNames.length}`;

  return withListValidations(withListsHidden, [
    {
      column: moduleCol,
      range: moduleRange,
      errorTitle: "Unknown module",
      error:
        "Pick a module from the list, or type a new name — import will create it if needed.",
    },
    {
      column: XLSX.utils.encode_col(headers.indexOf("Test Type")),
      values: TEST_TYPES.map((type) => TEST_TYPE_LABELS[type]),
      errorTitle: "Unknown test type",
      error:
        "Pick a value from the list, or keep yours — the import maps common spellings and falls back to Functional.",
    },
    {
      column: XLSX.utils.encode_col(headers.indexOf("Priority")),
      values: PRIORITIES.map((priority) => PRIORITY_LABELS[priority]),
      errorTitle: "Unknown priority",
      error:
        "Pick a value from the list, or keep yours — the import maps common spellings and falls back to Medium.",
    },
    {
      column: XLSX.utils.encode_col(headers.indexOf("Platform")),
      values: PLATFORMS.map((platform) => PLATFORM_LABELS[platform]),
      errorTitle: "Unknown platform",
      error:
        "Pick a value from the list, or keep yours — the import maps common spellings and falls back to Web.",
    },
  ]);
}
