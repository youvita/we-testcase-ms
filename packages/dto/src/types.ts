import type {
  AiJobKind,
  AiJobStatus,
  DraftStatus,
  ExecutionStatus,
  Platform,
  Priority,
  ProjectStatus,
  RequirementDocKind,
  Role,
  RunItemStatus,
  TestRunStatus,
  TestType,
} from "./enums";

/** Counts of test cases by execution status, plus derived totals. */
export type StatusBreakdown = {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  notRun: number;
  /** Executed = total - notRun. */
  executed: number;
  /** Percentage of cases with any result, 0–100, rounded. */
  executionRate: number;
  /** Passed / executed, 0–100, rounded. 0 when nothing has been executed. */
  passRate: number;
};

export type ModuleProgress = StatusBreakdown & {
  moduleId: string;
  moduleName: string;
};

export type DailyExecutionPoint = {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  passed: number;
  failed: number;
  blocked: number;
  total: number;
};

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ImportRowError = {
  /** 1-based row number in the source sheet, including the header row. */
  row: number;
  tcId: string | null;
  reason: string;
};

export type ImportSummary = {
  fileName: string;
  sheetName: string;
  rowsRead: number;
  created: number;
  updated: number;
  skippedEmpty: number;
  duplicatesInFile: number;
  modulesCreated: string[];
  /** Platforms the sheet used that the project had not enabled — now added. */
  platformsAdded: Platform[];
  errors: ImportRowError[];
  mappedColumns: Record<string, string>;
  unmappedColumns: string[];
};

/**
 * What importing a file *would* do, computed without writing anything.
 */
export type ImportPreview = {
  fileName: string;
  sheetName: string;
  rowsRead: number;
  testCases: number;
  modules: number;
  newModules: number;
  /** Platforms the import will add to the project. */
  platformsAdded: Platform[];
  duplicates: number;
  duplicatesInFile: number;
  newCases: number;
  skippedEmpty: number;
  warnings: number;
  unmappedColumns: string[];
  estimatedSeconds: number;
};

/** User payload safe for clients — never includes auth secrets. */
export type PublicUserDto = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  isActive: boolean;
  createdAt: string | Date;
};

export type StatusFilterValue = ExecutionStatus | "ALL";
export type TestTypeFilterValue = TestType | "ALL";
export type PriorityFilterValue = Priority | "ALL";
export type ProjectStatusFilterValue = ProjectStatus | "ALL";

/** Shared JSON envelope for REST responses. */
export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
};
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

// ---------------------------------------------------------------------------
// Requirements & AI
// ---------------------------------------------------------------------------

export type ClaudeConnectionStatus = {
  /** False when the server has no bridge configured — nothing to connect to. */
  aiConfigured: boolean;
  connected: boolean;
  /** Last four characters of the token. The token itself never leaves the server. */
  tokenHint: string | null;
  connectedAt: string | null;
};

export type AiJobDto = {
  id: string;
  kind: AiJobKind;
  status: AiJobStatus;
  progressDone: number;
  progressTotal: number;
  summary: string | null;
  error: string | null;
  docId: string | null;
  createdAt: string;
  finishedAt: string | null;
  createdBy: { id: string; name: string };
};

export type RequirementDocDto = {
  id: string;
  title: string;
  kind: RequirementDocKind;
  fileName: string | null;
  charCount: number;
  requirementCount: number;
  createdAt: string;
  createdBy: { id: string; name: string };
};

export type RequirementDto = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  openQuestions: string | null;
  section: string | null;
  docId: string;
  docTitle: string;
  testCases: { id: string; tcId: string; status: ExecutionStatus }[];
  /** Pending AI drafts that would cover this requirement. */
  pendingDraftCount: number;
};

export type TestCaseDraftDto = {
  id: string;
  status: DraftStatus;
  moduleName: string;
  title: string;
  preconditions: string | null;
  steps: string | null;
  expectedResult: string | null;
  testType: TestType;
  priority: Priority;
  platform: Platform;
  requirements: { id: string; code: string; title: string }[];
  createdAt: string;
};

export type DraftReviewResult = {
  accepted: { draftId: string; testCaseId: string; tcId: string }[];
  rejected: number;
  skipped: number;
};

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

export type RunVariableDto = {
  key: string;
  /** Null for a secret — the value stays on the server. */
  value: string | null;
  secret: boolean;
};

export type RunEnvironmentDto = {
  id: string;
  name: string;
  webBaseUrl: string | null;
  apiBaseUrl: string | null;
  variables: RunVariableDto[];
};

export type TestRunDto = {
  id: string;
  number: number;
  status: TestRunStatus;
  environmentName: string;
  recordResults: boolean;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  error: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: { id: string; name: string };
};

export type TestRunItemDto = {
  id: string;
  status: RunItemStatus;
  position: number;
  durationMs: number | null;
  error: string | null;
  log: string | null;
  code: string;
  testCase: { id: string; tcId: string; title: string; platform: Platform };
  /** Served at /api/run-items/:id/artifacts/:index. */
  artifacts: RunArtifactDto[];
  executionId: string | null;
};

export type RunArtifactKind = "screenshot" | "video" | "trace";

export type RunArtifactDto = {
  index: number;
  kind: RunArtifactKind;
  fileName: string;
  mimeType: string;
  size: number;
};

export type TestRunDetailDto = TestRunDto & { items: TestRunItemDto[] };

// --- Runner protocol (apps/runner ↔ /api/runner/*) ------------------------

export type RunnerJob = {
  run: { id: string; number: number; projectName: string };
  environment: {
    name: string;
    webBaseUrl: string | null;
    apiBaseUrl: string | null;
    /** Every variable, secrets included, decrypted for this run only. */
    vars: Record<string, string>;
  };
  items: {
    id: string;
    tcId: string;
    title: string;
    platform: Platform;
    code: string;
  }[];
};

export type RunnerItemResult = {
  status: Exclude<RunItemStatus, "QUEUED">;
  durationMs?: number;
  error?: string;
  log?: string;
};
