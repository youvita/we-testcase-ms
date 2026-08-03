import type { Role } from "@/lib/constants";
import type {
  Attachment,
  Comment,
  ExecutionStatus,
  FixStatus,
  FixStatusEvent,
  Module,
  Project,
  Priority,
  ProjectStatus,
  TestCase,
  TestExecution,
  TestType,
  User,
} from "@prisma/client";

export type {
  Attachment,
  Comment,
  ExecutionStatus,
  FixStatus,
  FixStatusEvent,
  Module,
  Priority,
  Project,
  ProjectStatus,
  TestCase,
  TestExecution,
  TestType,
};

/**
 * Public shape of a user — never includes auth material.
 *
 * `role` is narrowed to the Role union here rather than left as the database's
 * String, so UI components can use it directly. Services are responsible for
 * passing rows through `toRole` (lib/constants.ts) on the way out.
 */
export type PublicUser = Omit<
  Pick<
    User,
    "id" | "name" | "email" | "image" | "role" | "isActive" | "createdAt"
  >,
  "role"
> & { role: Role };

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

export type ProjectWithStats = Project & {
  qaOwner: Pick<User, "id" | "name" | "email" | "image"> | null;
  moduleCount: number;
  stats: StatusBreakdown;
};

export type DashboardSummary = {
  totalProjects: number;
  activeProjects: number;
  stats: StatusBreakdown;
  moduleProgress: ModuleProgress[];
  daily: DailyExecutionPoint[];
};

export type ExecutionWithDetails = TestExecution & {
  tester: Pick<User, "id" | "name" | "email" | "image">;
  attachments: Attachment[];
};

export type TestCaseListItem = Pick<
  TestCase,
  | "id"
  | "tcId"
  | "title"
  | "testType"
  | "priority"
  | "status"
  | "fixStatus"
  | "lastExecutedAt"
  | "updatedAt"
  | "moduleId"
> & {
  module: Pick<Module, "id" | "name">;
};

/**
 * A discussion post. `author.role` is left as the database String rather than
 * narrowed to Role — it is only used to label who is speaking.
 */
export type CommentWithAuthor = Comment & {
  author: Pick<User, "id" | "name" | "email" | "image" | "role">;
  /** Set on a withdrawn comment; `body` is blanked out when it is. */
  deletedBy: Pick<User, "id" | "name"> | null;
};

/** A logged developer triage change, with who made it. */
export type FixStatusEventWithActor = FixStatusEvent & {
  actor: Pick<User, "id" | "name">;
};

export type { FixStatusEvent as FixStatusEventRow };

export type TestCaseWithDetails = TestCase & {
  module: Pick<Module, "id" | "name">;
  project: Pick<Project, "id" | "name" | "version" | "environment">;
  executions: ExecutionWithDetails[];
  fixStatusBy: Pick<User, "id" | "name"> | null;
  fixStatusEvents: FixStatusEventWithActor[];
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
  /** Data rows examined, excluding the header. */
  rowsRead: number;
  created: number;
  updated: number;
  skippedEmpty: number;
  duplicatesInFile: number;
  modulesCreated: string[];
  errors: ImportRowError[];
  /** Header cells that were recognised, mapped to canonical field names. */
  mappedColumns: Record<string, string>;
  unmappedColumns: string[];
};

/**
 * What importing a file *would* do, computed without writing anything.
 *
 * `duplicates` counts TC IDs already in the project — how they are treated
 * depends on the skip/update mode chosen at import time.
 */
export type ImportPreview = {
  fileName: string;
  sheetName: string;
  /** Data rows examined, excluding the header. */
  rowsRead: number;
  /** Importable rows, after empty rows and in-file duplicates are dropped. */
  testCases: number;
  modules: number;
  newModules: number;
  duplicates: number;
  duplicatesInFile: number;
  newCases: number;
  skippedEmpty: number;
  /** Rows that will import but with a note against them. */
  warnings: number;
  unmappedColumns: string[];
  /** Rough, deliberately shown with a "~". */
  estimatedSeconds: number;
};

export type StatusFilterValue = ExecutionStatus | "ALL";
export type TestTypeFilterValue = TestType | "ALL";
export type PriorityFilterValue = Priority | "ALL";
export type ProjectStatusFilterValue = ProjectStatus | "ALL";
