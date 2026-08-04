import type {
  ExecutionStatus,
  Priority,
  ProjectStatus,
  Role,
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
