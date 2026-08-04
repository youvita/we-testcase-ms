/**
 * Domain enum values — framework-free source of truth shared by API, UI, and
 * future clients. Prisma schema must stay in sync with these string unions.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLES = {
  ADMIN: "ADMIN",
  QA: "QA",
  DEVELOPER: "DEVELOPER",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_VALUES = Object.values(ROLES) as Role[];

export function toRole(value: string | null | undefined): Role {
  return ROLE_VALUES.includes(value as Role) ? (value as Role) : ROLES.QA;
}

// ---------------------------------------------------------------------------
// Execution status
// ---------------------------------------------------------------------------

export const EXECUTION_STATUSES = [
  "PASSED",
  "FAILED",
  "BLOCKED",
  "NOT_RUN",
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Fix status
// ---------------------------------------------------------------------------

export const FIX_STATUS_ALL = [
  "NONE",
  "INVESTIGATING",
  "FIXED",
  "RETESTING",
  "WONT_FIX",
  "NOT_A_BUG",
] as const;

export type FixStatus = (typeof FIX_STATUS_ALL)[number];

/** Settable triage values for filtering (excludes resting NONE). */
export const FIX_STATUSES = [
  "INVESTIGATING",
  "FIXED",
  "RETESTING",
  "WONT_FIX",
  "NOT_A_BUG",
] as const;

export type FixStatusSettable = (typeof FIX_STATUSES)[number];

export const DEV_FIX_STATUSES = [
  "INVESTIGATING",
  "FIXED",
  "WONT_FIX",
  "NOT_A_BUG",
] as const;

export const PROGRESS_FIX_STATUSES = [
  "INVESTIGATING",
  "FIXED",
  "RETESTING",
] as const;

export const CLOSING_FIX_STATUSES = ["WONT_FIX", "NOT_A_BUG"] as const;

export function isClosingFixStatus(fixStatus: FixStatus) {
  return (CLOSING_FIX_STATUSES as readonly string[]).includes(fixStatus);
}

export function isProgressFixStatus(fixStatus: FixStatus) {
  return (PROGRESS_FIX_STATUSES as readonly string[]).includes(fixStatus);
}

// ---------------------------------------------------------------------------
// Test type / priority / project status
// ---------------------------------------------------------------------------

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
] as const;

export type TestType = (typeof TEST_TYPES)[number];

export const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export type Priority = (typeof PRIORITIES)[number];

export const PROJECT_STATUSES = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const EXCEL_REPORT_SCOPES = ["summary", "cases", "failed"] as const;
export type ExcelReportScope = (typeof EXCEL_REPORT_SCOPES)[number];
