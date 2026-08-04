import type { Priority, ProjectStatus, TestType } from "@prisma/client";

import {
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  ROLE_LABELS,
  TEST_TYPE_LABELS,
  type Role,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Test types are categories, not a severity scale, so these hues only need to
 * be distinguishable from one another — no colour implies "worse than".
 */
const TEST_TYPE_STYLES: Record<TestType, string> = {
  FUNCTIONAL: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  UI: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  API: "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  NEGATIVE:
    "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  INTEGRATION:
    "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  REGRESSION:
    "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  PERFORMANCE:
    "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  SECURITY: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  USABILITY: "border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-400",
  COMPATIBILITY: "border-border bg-muted text-muted-foreground",
};

export function TestTypeBadge({
  testType,
  className,
}: {
  testType: TestType;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        TEST_TYPE_STYLES[testType],
        className,
      )}
    >
      {TEST_TYPE_LABELS[testType]}
    </span>
  );
}

/** Severity scale — redder means more urgent. */
const PRIORITY_STYLES: Record<Priority, string> = {
  CRITICAL: "border-red-600/40 bg-red-600/15 text-red-700 dark:text-red-400",
  HIGH: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  MEDIUM:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  LOW: "border-border bg-muted text-muted-foreground",
};

export function PriorityBadge({
  priority,
  className,
}: {
  priority: Priority;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        PRIORITY_STYLES[priority],
        className,
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  PLANNING: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  ACTIVE:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  ON_HOLD:
    "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  COMPLETED:
    "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  ARCHIVED: "border-border bg-muted text-muted-foreground",
};

export function ProjectStatusBadge({
  status,
  className,
}: {
  status: ProjectStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        PROJECT_STATUS_STYLES[status],
        className,
      )}
    >
      {PROJECT_STATUS_LABELS[status]}
    </span>
  );
}

const ROLE_STYLES: Record<Role, string> = {
  ADMIN:
    "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  QA: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  DEVELOPER: "border-border bg-muted text-muted-foreground",
};

export function RoleBadge({
  role,
  className,
}: {
  role: Role;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        ROLE_STYLES[role],
        className,
      )}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}
