import { CircleDashed, CircleSlash, XCircle, CheckCircle2 } from "lucide-react";
import type { ExecutionStatus } from "@prisma/client";

import { EXECUTION_STATUS_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const STYLES: Record<ExecutionStatus, string> = {
  PASSED:
    "border-status-passed/30 bg-status-passed/10 text-status-passed dark:text-status-passed",
  FAILED: "border-status-failed/30 bg-status-failed/10 text-status-failed",
  BLOCKED: "border-status-blocked/30 bg-status-blocked/10 text-status-blocked",
  NOT_RUN: "border-border bg-muted text-muted-foreground",
};

const ICONS: Record<ExecutionStatus, typeof CheckCircle2> = {
  PASSED: CheckCircle2,
  FAILED: XCircle,
  BLOCKED: CircleSlash,
  NOT_RUN: CircleDashed,
};

/**
 * Execution status pill. Carries an icon as well as colour so the four states
 * stay distinguishable without relying on colour alone.
 */
export function StatusBadge({
  status,
  className,
  showIcon = true,
}: {
  status: ExecutionStatus;
  className?: string;
  showIcon?: boolean;
}) {
  const Icon = ICONS[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        STYLES[status],
        className,
      )}
    >
      {showIcon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {EXECUTION_STATUS_LABELS[status]}
    </span>
  );
}
