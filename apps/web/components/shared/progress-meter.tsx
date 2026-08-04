import { cn } from "@/lib/utils";
import type { StatusBreakdown } from "@/types";

/**
 * Stacked pass/fail/blocked/not-run bar.
 *
 * Used for both project and module progress so the same visual language means
 * the same thing everywhere.
 */
export function StatusMeter({
  stats,
  className,
  height = "h-2",
}: {
  stats: StatusBreakdown;
  className?: string;
  height?: string;
}) {
  const segments = [
    { key: "passed", value: stats.passed, className: "bg-status-passed" },
    { key: "failed", value: stats.failed, className: "bg-status-failed" },
    { key: "blocked", value: stats.blocked, className: "bg-status-blocked" },
  ];

  return (
    <div
      className={cn(
        "flex w-full overflow-hidden rounded-full bg-muted",
        height,
        className,
      )}
      role="img"
      aria-label={`${stats.passed} passed, ${stats.failed} failed, ${stats.blocked} blocked, ${stats.notRun} not run`}
    >
      {stats.total > 0 &&
        segments.map((segment) =>
          segment.value === 0 ? null : (
            <div
              key={segment.key}
              className={segment.className}
              style={{ width: `${(segment.value / stats.total) * 100}%` }}
            />
          ),
        )}
    </div>
  );
}

/** Small legend explaining the meter's colours. */
export function StatusMeterLegend({
  stats,
  className,
}: {
  stats: StatusBreakdown;
  className?: string;
}) {
  const items = [
    { label: "Passed", value: stats.passed, dot: "bg-status-passed" },
    { label: "Failed", value: stats.failed, dot: "bg-status-failed" },
    { label: "Blocked", value: stats.blocked, dot: "bg-status-blocked" },
    { label: "Not Run", value: stats.notRun, dot: "bg-status-notrun" },
  ];

  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", item.dot)} aria-hidden />
          {item.label}
          <span className="font-medium tabular-nums text-foreground">
            {item.value}
          </span>
        </li>
      ))}
    </ul>
  );
}
