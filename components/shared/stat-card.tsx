import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "passed" | "failed" | "blocked" | "notrun";

const TONE_ACCENT: Record<StatTone, string> = {
  default: "text-foreground",
  passed: "text-status-passed",
  failed: "text-status-failed",
  blocked: "text-status-blocked",
  notrun: "text-muted-foreground",
};

const TONE_ICON_BG: Record<StatTone, string> = {
  default: "bg-muted text-muted-foreground",
  passed: "bg-status-passed/10 text-status-passed",
  failed: "bg-status-failed/10 text-status-failed",
  blocked: "bg-status-blocked/10 text-status-blocked",
  notrun: "bg-muted text-muted-foreground",
};

/** A single dashboard metric tile. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="flex items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              "mt-1.5 text-2xl font-semibold tabular-nums sm:text-3xl",
              TONE_ACCENT[tone],
            )}
          >
            {value}
          </p>
          {hint && (
            <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
          )}
        </div>

        {Icon && (
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              TONE_ICON_BG[tone],
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
        )}
      </CardContent>
    </Card>
  );
}
