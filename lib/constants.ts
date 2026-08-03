import type {
  ExecutionStatus,
  FixStatus,
  Priority,
  ProjectStatus,
  TestType,
} from "@prisma/client";

export const ROLES = {
  ADMIN: "ADMIN",
  QA: "QA",
  DEVELOPER: "DEVELOPER",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_VALUES = Object.values(ROLES) as Role[];

/**
 * Narrow the database's `role` column (a String — see the note in
 * schema.prisma) to the Role union, falling back to QA for anything
 * unrecognised.
 *
 * Use this at every boundary where a role leaves the database, so consumers
 * never have to hand-roll their own narrowing.
 */
export function toRole(value: string | null | undefined): Role {
  return ROLE_VALUES.includes(value as Role) ? (value as Role) : ROLES.QA;
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  QA: "QA",
  DEVELOPER: "Developer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Manages users and all projects",
  QA: "Creates projects, imports and executes test cases",
  DEVELOPER: "Reviews failures, comments and flags fixes for retest",
};

// ---------------------------------------------------------------------------
// Execution status
// ---------------------------------------------------------------------------

export const EXECUTION_STATUSES = [
  "PASSED",
  "FAILED",
  "BLOCKED",
  "NOT_RUN",
] as const satisfies readonly ExecutionStatus[];

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  PASSED: "Passed",
  FAILED: "Failed",
  BLOCKED: "Blocked",
  NOT_RUN: "Not Run",
};

/// Chart-facing colors. Kept as raw hsl() strings because Recharts needs a
/// concrete value, not a Tailwind class.
export const EXECUTION_STATUS_COLORS: Record<ExecutionStatus, string> = {
  PASSED: "hsl(142 71% 45%)",
  FAILED: "hsl(0 72% 51%)",
  BLOCKED: "hsl(38 92% 50%)",
  NOT_RUN: "hsl(215 16% 65%)",
};

// ---------------------------------------------------------------------------
// Fix status (developer triage)
// ---------------------------------------------------------------------------

/// Every settable value, for filtering. NONE is the resting state and never
/// appears as a choice — it is what a new execution resets to.
export const FIX_STATUSES = [
  "INVESTIGATING",
  "FIXED",
  "RETESTING",
  "WONT_FIX",
  "NOT_A_BUG",
] as const satisfies readonly FixStatus[];

/// What a developer may set. RETESTING is absent because it is QA's to claim —
/// a developer cannot know that someone has started re-running the case.
export const DEV_FIX_STATUSES = [
  "INVESTIGATING",
  "FIXED",
  "WONT_FIX",
  "NOT_A_BUG",
] as const satisfies readonly FixStatus[];

/// The live hand-off between QA and engineering: dev picks it up, dev ships,
/// QA re-runs. These are the three worth showing beside a result in the list;
/// "won't fix" and "not a bug" close a case rather than progress it.
export const PROGRESS_FIX_STATUSES = [
  "INVESTIGATING",
  "FIXED",
  "RETESTING",
] as const satisfies readonly FixStatus[];

/// Decisions that overrule a reported failure instead of moving it along. Both
/// require a reason, since they close the case without a fix.
export const CLOSING_FIX_STATUSES = [
  "WONT_FIX",
  "NOT_A_BUG",
] as const satisfies readonly FixStatus[];

export function isClosingFixStatus(fixStatus: FixStatus) {
  return (CLOSING_FIX_STATUSES as readonly FixStatus[]).includes(fixStatus);
}

export function isProgressFixStatus(fixStatus: FixStatus) {
  return (PROGRESS_FIX_STATUSES as readonly FixStatus[]).includes(fixStatus);
}

export const FIX_STATUS_LABELS: Record<FixStatus, string> = {
  NONE: "No update",
  INVESTIGATING: "Investigating",
  FIXED: "Fixed — ready for retest",
  RETESTING: "Retesting",
  WONT_FIX: "Won't fix",
  NOT_A_BUG: "Not a bug",
};

/// Short form for badges, where the full "ready for retest" phrasing is too
/// long to sit beside a status pill.
export const FIX_STATUS_SHORT_LABELS: Record<FixStatus, string> = {
  NONE: "No update",
  INVESTIGATING: "Investigating",
  FIXED: "Fix ready",
  RETESTING: "Retesting",
  WONT_FIX: "Won't fix",
  NOT_A_BUG: "Not a bug",
};

export const FIX_STATUS_HINTS: Record<FixStatus, string> = {
  NONE: "",
  INVESTIGATING: "Someone is looking at this — QA need not retest yet.",
  FIXED: "A fix has shipped. QA should run this case again.",
  RETESTING: "QA has picked the fix up and is re-running the case.",
  WONT_FIX: "Accepted as-is for now. Say why.",
  NOT_A_BUG: "The expected result or the test itself needs revisiting. Say why.",
};

// ---------------------------------------------------------------------------
// Test type
// ---------------------------------------------------------------------------

/// Listed in the same order as the `TestType` enum in schema.prisma, so the
/// filter dropdown and a Postgres `ORDER BY testType` agree.
export const TEST_TYPES = [
  "FUNCTIONAL",
  "UI",
  "API",
  "NEGATIVE",
  "INTEGRATION",
  "REGRESSION",
  "PERFORMANCE",
  "SECURITY",
  "USABILITY",
  "COMPATIBILITY",
] as const satisfies readonly TestType[];

export const TEST_TYPE_LABELS: Record<TestType, string> = {
  FUNCTIONAL: "Functional",
  UI: "UI",
  API: "API",
  NEGATIVE: "Negative",
  INTEGRATION: "Integration",
  REGRESSION: "Regression",
  PERFORMANCE: "Performance",
  SECURITY: "Security",
  USABILITY: "Usability",
  COMPATIBILITY: "Compatibility",
};

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/// Listed in the same order as the `Priority` enum in schema.prisma.
export const PRIORITIES = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const satisfies readonly Priority[];

export const PRIORITY_LABELS: Record<Priority, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

// ---------------------------------------------------------------------------
// Project status
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
] as const satisfies readonly ProjectStatus[];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

// ---------------------------------------------------------------------------
// Uploads & pagination
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

/// QuickTime is here because that is what an iPhone screen recording produces,
/// and phones are where a lot of mobile-banking evidence comes from.
export const ALLOWED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export const ALLOWED_UPLOAD_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_VIDEO_MIME_TYPES,
] as const;

export const MAX_UPLOAD_BYTES = Number(
  process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024,
);

/// Screen recordings dwarf screenshots, so they get their own ceiling — a 5 MB
/// cap would reject almost every usable clip.
export const MAX_VIDEO_UPLOAD_BYTES = Number(
  process.env.MAX_VIDEO_UPLOAD_BYTES ?? 50 * 1024 * 1024,
);

export function isVideoMimeType(mimeType: string) {
  return (ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(mimeType);
}

export const ALLOWED_IMPORT_EXTENSIONS = [".xlsx", ".xls", ".csv"] as const;

/** Which sheets an Excel project export includes. */
export const EXCEL_REPORT_SCOPES = ["summary", "cases", "failed"] as const;
export type ExcelReportScope = (typeof EXCEL_REPORT_SCOPES)[number];
