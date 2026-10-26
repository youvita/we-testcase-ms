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
  TestRunPurpose,
  TestRunStatus,
  TestType,
  TriageCategory,
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
  /** What the job produced, e.g. ScriptWritingResult for WRITE_SCRIPT. */
  result: unknown;
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
  subModule: string | null;
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
  /** Where Web work starts, e.g. "/kh/login"; null means "/". */
  startPath: string | null;
  variables: RunVariableDto[];
};

export type TestRunDto = {
  id: string;
  /** Null once the environment is deleted. */
  environmentId: string | null;
  /** Null for script checks. */
  number: number | null;
  purpose: TestRunPurpose;
  status: TestRunStatus;
  environmentName: string;
  recordResults: boolean;
  liveView: boolean;
  slowMoMs: number;
  inOrder: boolean;
  /** The case that signed in before each Web case, if one did. */
  setupTcId: string | null;
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
  /** Null for an exploration, which visits pages before any case exists. */
  testCase: { id: string; tcId: string; title: string; platform: Platform } | null;
  /** Served at /api/run-items/:id/artifacts/:index. */
  artifacts: RunArtifactDto[];
  executionId: string | null;
  triage: RunTriageDto | null;
  /** The case's script as it is now — to tell whether a fix was applied. */
  currentCode: string | null;
  /** The script was a draft: a failure here was not recorded on the case. */
  draft: boolean;
  /** HTTP errors and failed requests seen during the test. */
  failedRequests: FailedRequest[];
};

/**
 * "snapshot" is Playwright's text outline of the page when the test ended:
 * every field and button with its role and name. Claude reads it to find
 * what is actually on the page.
 */
export type RunArtifactKind = "screenshot" | "video" | "trace" | "snapshot" | "network";

/**
 * A request that went wrong during a test — an HTTP error status, or no
 * response at all. The runner records them as the "network" artifact.
 */
export type FailedRequest = {
  method: string;
  url: string;
  /** Null when there was no response (refused, timed out, aborted). */
  status: number | null;
  statusText: string;
};

export type RunTriageDto = {
  category: TriageCategory;
  summary: string;
  explanation: string;
  /** A corrected script, when the script is at fault. */
  fixedCode: string | null;
  /** A ready-to-file report, when the product is at fault. */
  bugReport: {
    title: string;
    steps: string;
    expected: string;
    actual: string;
  } | null;
  triagedAt: string;
};

/** One case of a script-writing batch, for the progress panel. */
export type ScriptJobRow = {
  jobId: string;
  batchId: string | null;
  status: AiJobStatus;
  progressDone: number;
  progressTotal: number;
  outcome: ScriptWritingResult["outcome"] | null;
  saved: boolean;
  error: string | null;
  createdAt: string;
  testCase: { id: string; tcId: string; title: string } | null;
};

export type ScriptBatchResult = {
  batchId: string;
  queued: { tcId: string }[];
  skipped: { tcId: string; reason: string }[];
};

/** What an EXPLORE_APP job leaves in `AiJobDto.result`. */
export type ExploreAppResult = {
  pages: { url: string; title: string }[];
  drafted: number;
  /** Things Claude noticed on the pages that are not test cases. */
  observations: string[];
  runId: string | null;
};

/** What a WRITE_SCRIPT job leaves in `AiJobDto.result`. */
export type ScriptWritingResult = {
  testCaseId: string;
  /**
   * passed      — the script ran green against the environment
   * product_bug — the script reaches the check and the product fails it
   * needs_info  — Claude cannot go further without something only QA knows
   * failing     — still failing after every attempt
   */
  outcome: "passed" | "product_bug" | "needs_info" | "failing";
  code: string;
  notes: string;
  /** The script check running right now, so the page can show it live. */
  currentRunId?: string | null;
  /** Saved on the case without review — only ever for a script that passed. */
  saved?: boolean;
  attempts: {
    code: string;
    runId: string;
    status: RunItemStatus;
    error: string | null;
    /** How long its run took. */
    durationMs?: number | null;
    /** Claude's one line on what this version changed; absent on older tries. */
    change?: string;
    /** The earlier try a continued round picked up from, not one of its own. */
    earlier?: boolean;
  }[];
};

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
  /** `label` is "Run #12" or "Script check", for logs. */
  run: {
    id: string;
    label: string;
    projectName: string;
    /** Pause between browser actions, in ms. */
    slowMoMs: number;
    /** One test at a time, in file order. */
    inOrder: boolean;
    /** Set when someone is watching: a token good only for this run's frames. */
    liveToken: string | null;
  };
  environment: {
    name: string;
    webBaseUrl: string | null;
    apiBaseUrl: string | null;
    /** Every variable, secrets included, decrypted for this run only. */
    vars: Record<string, string>;
    /**
     * Which of `vars` are secret. Their values are masked in everything the
     * runner sends back — page outlines record what was typed into fields.
     */
    secretKeys: string[];
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
