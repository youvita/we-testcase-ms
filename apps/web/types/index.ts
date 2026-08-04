import type { Role } from "@wetestcase/dto";
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

// Framework-free DTOs — re-exported so existing `@/types` imports keep working.
export type {
  StatusBreakdown,
  ModuleProgress,
  DailyExecutionPoint,
  Paginated,
  ImportRowError,
  ImportSummary,
  ImportPreview,
  StatusFilterValue,
  TestTypeFilterValue,
  PriorityFilterValue,
  ProjectStatusFilterValue,
} from "@wetestcase/dto";

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
 * passing rows through `toRole` on the way out.
 */
export type PublicUser = Omit<
  Pick<
    User,
    "id" | "name" | "email" | "image" | "role" | "isActive" | "createdAt"
  >,
  "role"
> & { role: Role };

export type ProjectWithStats = Project & {
  qaOwner: Pick<User, "id" | "name" | "email" | "image"> | null;
  moduleCount: number;
  stats: import("@wetestcase/dto").StatusBreakdown;
};

export type DashboardSummary = {
  totalProjects: number;
  activeProjects: number;
  stats: import("@wetestcase/dto").StatusBreakdown;
  moduleProgress: import("@wetestcase/dto").ModuleProgress[];
  daily: import("@wetestcase/dto").DailyExecutionPoint[];
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
