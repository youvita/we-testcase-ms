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

/**
 * Where a case is tested. Not a test type: an API case can be functional,
 * negative or security. iOS and Android are separate on purpose — behaviour
 * and automation tooling differ between them.
 */
export const PLATFORMS = ["WEB", "API", "IOS", "ANDROID"] as const;

export type Platform = (typeof PLATFORMS)[number];

export const PROJECT_STATUSES = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * Environments offered by default when creating a project.
 *
 * Suggestions, not a closed set: the column stays free text so a team can name
 * an environment these three do not cover, and whatever they type is offered
 * alongside these the next time.
 */
export const PROJECT_ENVIRONMENTS = ["SIT", "UAT", "PRO"] as const;

export type ProjectEnvironment = (typeof PROJECT_ENVIRONMENTS)[number];

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const EXCEL_REPORT_SCOPES = ["summary", "cases", "failed"] as const;
export type ExcelReportScope = (typeof EXCEL_REPORT_SCOPES)[number];

// ---------------------------------------------------------------------------
// Requirements & AI
// ---------------------------------------------------------------------------

export const REQUIREMENT_DOC_KINDS = ["PRD", "FRD", "OTHER"] as const;
export type RequirementDocKind = (typeof REQUIREMENT_DOC_KINDS)[number];

export const AI_JOB_KINDS = [
  "EXTRACT_REQUIREMENTS",
  "GENERATE_TEST_CASES",
  "WRITE_SCRIPT",
  "TRIAGE_FAILURE",
  "EXPLORE_APP",
  "GENERATE_FRD",
] as const;
export type AiJobKind = (typeof AI_JOB_KINDS)[number];

export const AI_JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

export const DRAFT_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** How many cases to ask for per requirement. */
export const GENERATION_DEPTHS = ["essential", "thorough"] as const;

/** AI models a person can pick for a job; the bridge takes these aliases. */
export const AI_MODELS = ["sonnet", "opus", "haiku"] as const;
export type AiModel = (typeof AI_MODELS)[number];

export const AI_MODEL_LABELS: Record<AiModel, { label: string; hint: string }> = {
  sonnet: { label: "Sonnet", hint: "Balanced — the default" },
  opus: { label: "Opus", hint: "Most capable, slower; uses more of your plan" },
  haiku: { label: "Haiku", hint: "Fastest, for simple flows" },
};
export type GenerationDepth = (typeof GENERATION_DEPTHS)[number];

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

export const TEST_RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "PASSED",
  "FAILED",
  "ERROR",
  "CANCELLED",
] as const;
export type TestRunStatus = (typeof TEST_RUN_STATUSES)[number];

export const RUN_ITEM_STATUSES = [
  "QUEUED",
  "PASSED",
  "FAILED",
  "ERROR",
  "SKIPPED",
] as const;
export type RunItemStatus = (typeof RUN_ITEM_STATUSES)[number];

export const TEST_RUN_PURPOSES = ["RUN", "SCRIPT_CHECK"] as const;
export type TestRunPurpose = (typeof TEST_RUN_PURPOSES)[number];

/** How Claude reads a failed automated result. */
export const TRIAGE_CATEGORIES = [
  "product_bug",
  "script_issue",
  "environment",
  "unclear",
] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

/** Platforms the runner can execute today. Mobile needs device tooling. */
export const AUTOMATABLE_PLATFORMS = ["WEB", "API"] as const;

export function isAutomatablePlatform(platform: Platform): boolean {
  return (AUTOMATABLE_PLATFORMS as readonly string[]).includes(platform);
}

/**
 * How fast to drive the browser when someone is watching: none, then a pause
 * between actions long enough to follow.
 */
export const RUN_SPEEDS = { normal: 0, slow: 500, slower: 1200 } as const;
export type RunSpeed = keyof typeof RUN_SPEEDS;

/** Which cases a new run takes. */
export const RUN_SCOPES = ["all", "failed", "module", "cases"] as const;
export type RunScope = (typeof RUN_SCOPES)[number];
