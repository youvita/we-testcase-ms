import { Ban, CircleHelp, RefreshCw, RotateCcw, Wrench } from "lucide-react";
import type { FixStatus } from "@prisma/client";

import { FIX_STATUS_SHORT_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const STYLES: Record<Exclude<FixStatus, "NONE">, string> = {
  INVESTIGATING: "border-status-blocked/30 bg-status-blocked/10 text-status-blocked",
  FIXED: "border-primary/30 bg-primary/10 text-primary",
  RETESTING: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  WONT_FIX: "border-border bg-muted text-muted-foreground",
  NOT_A_BUG: "border-border bg-muted text-muted-foreground",
};

const ICONS: Record<Exclude<FixStatus, "NONE">, typeof Wrench> = {
  INVESTIGATING: Wrench,
  FIXED: RotateCcw,
  RETESTING: RefreshCw,
  WONT_FIX: Ban,
  NOT_A_BUG: CircleHelp,
};

/**
 * The developer's answer to a failure, shown beside the execution status.
 *
 * Visually distinct from StatusBadge on purpose — the two say different kinds
 * of thing, and a reader should never mistake "Ready for retest" for a result.
 */
export function FixStatusBadge({
  fixStatus,
  className,
}: {
  fixStatus: FixStatus;
  className?: string;
}) {
  // NONE is the resting state, not something worth a pill.
  if (fixStatus === "NONE") return null;

  const Icon = ICONS[fixStatus];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed px-2 py-0.5 text-xs font-medium",
        STYLES[fixStatus],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {FIX_STATUS_SHORT_LABELS[fixStatus]}
    </span>
  );
}
