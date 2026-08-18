import type {
  ExecutionStatus,
  FixStatus,
  Platform,
  Priority,
  ProjectStatus,
  TestType,
} from "@wetestcase/dto";

// Domain enum values + helpers — shared via @wetestcase/dto
export {
  ROLES,
  ROLE_VALUES,
  toRole,
  EXECUTION_STATUSES,
  FIX_STATUSES,
  DEV_FIX_STATUSES,
  PROGRESS_FIX_STATUSES,
  CLOSING_FIX_STATUSES,
  isClosingFixStatus,
  isProgressFixStatus,
  TEST_TYPES,
  PRIORITIES,
  PLATFORMS,
  PROJECT_STATUSES,
  PROJECT_ENVIRONMENTS,
  EXCEL_REPORT_SCOPES,
  type Role,
  type Platform,
  type ExcelReportScope,
} from "@wetestcase/dto";

export const ROLE_LABELS: Record<import("@wetestcase/dto").Role, string> = {
  ADMIN: "Admin",
  QA: "QA",
  DEVELOPER: "Developer",
};

export const ROLE_DESCRIPTIONS: Record<
  import("@wetestcase/dto").Role,
  string
> = {
  ADMIN: "Manages users and all projects",
  QA: "Creates projects, imports and executes test cases",
  DEVELOPER: "Reviews failures, comments and flags fixes for retest",
};

// ---------------------------------------------------------------------------
// Execution status (UI labels)
// ---------------------------------------------------------------------------

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
// Fix status (UI labels)
// ---------------------------------------------------------------------------

export const FIX_STATUS_LABELS: Record<FixStatus, string> = {
  NONE: "No update",
  INVESTIGATING: "Investigating",
  FIXED: "Fixed — ready for retest",
  RETESTING: "Retesting",
  WONT_FIX: "Won't fix",
  NOT_A_BUG: "Not a bug",
};

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
// Test type / priority / project status labels
// ---------------------------------------------------------------------------

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

export const PRIORITY_LABELS: Record<Priority, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  WEB: "Web",
  IOS: "iOS",
  ANDROID: "Android",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

// ---------------------------------------------------------------------------
// Uploads & pagination (web runtime)
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

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

export const MAX_VIDEO_UPLOAD_BYTES = Number(
  process.env.MAX_VIDEO_UPLOAD_BYTES ?? 50 * 1024 * 1024,
);

export function isVideoMimeType(mimeType: string) {
  return (ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(mimeType);
}

export const ALLOWED_IMPORT_EXTENSIONS = [".xlsx", ".xls", ".csv"] as const;
