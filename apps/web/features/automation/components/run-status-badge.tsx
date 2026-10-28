import {
  Ban,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { RunItemStatus, TestRunStatus } from "@wetestcase/dto";

type AnyStatus = TestRunStatus | RunItemStatus;

const LABELS: Record<AnyStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  PASSED: "Passed",
  FAILED: "Failed",
  ERROR: "Error",
  CANCELLED: "Cancelled",
  SKIPPED: "Skipped",
};

const STYLES: Record<AnyStatus, string> = {
  QUEUED: "border-border bg-muted text-muted-foreground",
  RUNNING: "border-primary/30 bg-primary/10 text-primary",
  PASSED: "border-status-passed/30 bg-status-passed/10 text-status-passed",
  FAILED: "border-status-failed/30 bg-status-failed/10 text-status-failed",
  // Error is about the script or the runner, not the product — amber, so it
  // never reads as a product failure at a glance.
  ERROR: "border-status-blocked/30 bg-status-blocked/10 text-status-blocked",
  CANCELLED: "border-border bg-muted text-muted-foreground",
  SKIPPED: "border-border bg-muted text-muted-foreground",
};

const ICONS: Record<AnyStatus, typeof CheckCircle2> = {
  QUEUED: Clock,
  RUNNING: Loader2,
  PASSED: CheckCircle2,
  FAILED: XCircle,
  ERROR: CircleAlert,
  CANCELLED: Ban,
  SKIPPED: CircleDashed,
};

/** Status pill for automated runs and their items. */
export function RunStatusBadge({
  status,
  className,
}: {
  status: AnyStatus;
  className?: string;
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
      <Icon
        className={cn("size-3.5 shrink-0", status === "RUNNING" && "animate-spin")}
        aria-hidden
      />
      {LABELS[status]}
    </span>
  );
}

export function isRunActive(status: TestRunStatus) {
  return status === "QUEUED" || status === "RUNNING";
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}
