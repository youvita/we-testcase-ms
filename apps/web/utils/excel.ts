import type { Priority, TestType } from "@prisma/client";

/**
 * Header matching for imported sheets.
 *
 * Organisations keep using their own Excel templates, so column headings vary
 * ("TC ID", "Test Case ID", "Case No."). Each canonical field lists the aliases
 * we accept; matching is case/space/punctuation-insensitive.
 */
export const CANONICAL_FIELDS = [
  "tcId",
  "module",
  "title",
  "preconditions",
  "steps",
  "expectedResult",
  "testType",
  "priority",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  tcId: [
    "tcid",
    "tc",
    "tcno",
    "testcaseid",
    "testid",
    "caseid",
    "caseno",
    "id",
    "no",
    "sn",
    "srno",
    "serialno",
  ],
  module: ["module", "modulename", "feature", "functionality", "component", "screen", "epic"],
  title: [
    "testcase",
    "testcasename",
    "testcasetitle",
    "testcasedescription",
    "testscenario",
    "scenario",
    "title",
    "description",
    "testdescription",
    "summary",
    "testname",
  ],
  preconditions: [
    "precondition",
    "preconditions",
    "prerequisite",
    "prerequisites",
    "precondition(s)",
    "setup",
    "given",
  ],
  steps: [
    "steps",
    "teststeps",
    "step",
    "stepstoreproduce",
    "procedure",
    "testprocedure",
    "action",
    "actions",
    "when",
    "stepdescription",
  ],
  expectedResult: [
    "expectedresult",
    "expectedresults",
    "expected",
    "expectedoutput",
    "expectedbehaviour",
    "expectedbehavior",
    "then",
    "acceptancecriteria",
  ],
  testType: [
    "testtype",
    "type",
    "testcategory",
    "category",
    "testinglevel",
    "testlevel",
    "kind",
  ],
  priority: [
    "priority",
    "prioritylevel",
    "severity",
    "importance",
    "criticality",
  ],
};

/** Strip everything but letters and digits so "TC ID" == "tc_id" == "TC-Id". */
export function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Map raw sheet headers onto canonical field names.
 *
 * Returns the mapping plus the headers we could not place, which the import
 * summary shows so QA can see exactly what was ignored.
 */
export function mapHeaders(headers: string[]): {
  mapping: Partial<Record<CanonicalField, number>>;
  mappedColumns: Record<string, string>;
  unmappedColumns: string[];
} {
  const mapping: Partial<Record<CanonicalField, number>> = {};
  const mappedColumns: Record<string, string> = {};
  const unmappedColumns: string[] = [];

  headers.forEach((rawHeader, index) => {
    const header = (rawHeader ?? "").toString().trim();
    if (!header) return;

    const normalized = normalizeHeader(header);
    if (!normalized) return;

    const field = (CANONICAL_FIELDS as readonly CanonicalField[]).find(
      (candidate) => {
        // Already claimed by an earlier column — first match wins so a sheet
        // with both "Description" and "Expected Result" keeps them distinct.
        if (mapping[candidate] !== undefined) return false;
        return HEADER_ALIASES[candidate].includes(normalized);
      },
    );

    if (field) {
      mapping[field] = index;
      mappedColumns[header] = field;
    } else {
      unmappedColumns.push(header);
    }
  });

  return { mapping, mappedColumns, unmappedColumns };
}

/**
 * Spellings seen in real sheets, normalised the same way headers are (letters
 * and digits only), so "Non-Functional", "non functional" and "nonfunctional"
 * all land on the same value.
 */
const TEST_TYPE_ALIASES: Record<string, TestType> = {
  functional: "FUNCTIONAL",
  function: "FUNCTIONAL",
  func: "FUNCTIONAL",
  positive: "FUNCTIONAL",
  happypath: "FUNCTIONAL",
  smoke: "FUNCTIONAL",
  sanity: "FUNCTIONAL",
  ui: "UI",
  uiux: "UI",
  ux: "UI",
  visual: "UI",
  layout: "UI",
  api: "API",
  service: "API",
  backend: "API",
  contract: "API",
  negative: "NEGATIVE",
  invalid: "NEGATIVE",
  errorhandling: "NEGATIVE",
  edgecase: "NEGATIVE",
  boundary: "NEGATIVE",
  integration: "INTEGRATION",
  e2e: "INTEGRATION",
  endtoend: "INTEGRATION",
  system: "INTEGRATION",
  regression: "REGRESSION",
  performance: "PERFORMANCE",
  perf: "PERFORMANCE",
  load: "PERFORMANCE",
  stress: "PERFORMANCE",
  security: "SECURITY",
  auth: "SECURITY",
  penetration: "SECURITY",
  pentest: "SECURITY",
  usability: "USABILITY",
  accessibility: "USABILITY",
  a11y: "USABILITY",
  compatibility: "COMPATIBILITY",
  compat: "COMPATIBILITY",
  crossbrowser: "COMPATIBILITY",
  device: "COMPATIBILITY",
};

/**
 * Coerce a spreadsheet test-type cell into the TestType enum.
 *
 * Unrecognised values fall back to FUNCTIONAL rather than failing the row —
 * an unfamiliar label is not a reason to lose a test case. The import summary
 * still reports the column as mapped, so QA can spot-check what landed.
 */
export function parseTestType(value: unknown): TestType {
  if (value === null || value === undefined) return "FUNCTIONAL";
  const key = normalizeHeader(value.toString());
  if (!key) return "FUNCTIONAL";
  return TEST_TYPE_ALIASES[key] ?? "FUNCTIONAL";
}

const PRIORITY_ALIASES: Record<string, Priority> = {
  critical: "CRITICAL",
  crit: "CRITICAL",
  p0: "CRITICAL",
  blocker: "CRITICAL",
  high: "HIGH",
  hi: "HIGH",
  p1: "HIGH",
  major: "HIGH",
  medium: "MEDIUM",
  med: "MEDIUM",
  normal: "MEDIUM",
  p2: "MEDIUM",
  moderate: "MEDIUM",
  low: "LOW",
  p3: "LOW",
  minor: "LOW",
  trivial: "LOW",
};

/**
 * Coerce a spreadsheet priority cell into the Priority enum.
 *
 * Blank or unrecognised values fall back to MEDIUM — same default as a newly
 * created case in the UI.
 */
export function parsePriority(value: unknown): Priority {
  if (value === null || value === undefined) return "MEDIUM";
  const key = normalizeHeader(value.toString());
  if (!key) return "MEDIUM";
  return PRIORITY_ALIASES[key] ?? "MEDIUM";
}

/**
 * Normalise a cell into a trimmed string.
 *
 * Excel hands back numbers, dates and booleans as well as strings; multi-line
 * step cells keep their newlines but lose trailing whitespace per line.
 */
export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value
    .toString()
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/** True when every mapped cell in the row is blank. */
export function isRowEmpty(cells: unknown[]): boolean {
  return cells.every((cell) => cellToString(cell) === "");
}
