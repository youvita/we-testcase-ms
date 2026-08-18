import { PieChartIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  EXECUTION_STATUSES,
  EXECUTION_STATUS_COLORS,
  EXECUTION_STATUS_LABELS,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { ExecutionStatus, StatusBreakdown } from "@/types";
import { formatPercent } from "@/utils/format";

type Slice = {
  status: ExecutionStatus;
  label: string;
  value: number;
  color: string;
};

function countFor(stats: StatusBreakdown, status: ExecutionStatus): number {
  switch (status) {
    case "PASSED":
      return stats.passed;
    case "FAILED":
      return stats.failed;
    case "BLOCKED":
      return stats.blocked;
    case "NOT_RUN":
      return stats.notRun;
    default:
      return 0;
  }
}

/**
 * CSS donut — Recharts Pie + ResponsiveContainer throws on a 0×0 box and on a
 * single 360° slice (every current project is 100% Not Run). A conic-gradient
 * does not.
 */
function CssDonut({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let start = 0;
  const stops = slices.map((slice) => {
    const end = start + (slice.value / total) * 360;
    const stop = `${slice.color} ${start}deg ${end}deg`;
    start = end;
    return stop;
  });

  return (
    <div
      className="mx-auto size-[184px] rounded-full"
      style={{
        background: `conic-gradient(${stops.join(", ")})`,
        maskImage:
          "radial-gradient(farthest-side, transparent 61px, #000 62px)",
        WebkitMaskImage:
          "radial-gradient(farthest-side, transparent 61px, #000 62px)",
      }}
      aria-hidden
    />
  );
}

/** Donut of test cases by execution status, with the execution rate in the centre. */
export function StatusDonut({
  stats,
  className,
}: {
  stats: StatusBreakdown;
  className?: string;
}) {
  const slices: Slice[] = EXECUTION_STATUSES.map((status) => ({
    status,
    label: EXECUTION_STATUS_LABELS[status],
    value: countFor(stats, status),
    color: EXECUTION_STATUS_COLORS[status],
  })).filter((slice) => slice.value > 0);

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardTitle>Execution Status</CardTitle>
        <CardDescription>
          {stats.total > 0
            ? `${stats.executed} of ${stats.total} test cases executed`
            : "No test cases yet"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {stats.total === 0 ? (
          <EmptyState
            icon={PieChartIcon}
            title="Nothing to chart yet"
            description="Import or create test cases to see the execution breakdown."
          />
        ) : (
          <>
            <div className="relative h-[240px] w-full">
              <div className="flex h-full items-center justify-center">
                <CssDonut slices={slices} />
              </div>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-semibold tabular-nums leading-none">
                  {formatPercent(stats.executionRate)}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">
                  Executed
                </span>
              </div>
            </div>

            <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {EXECUTION_STATUSES.map((status) => (
                <li key={status} className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: EXECUTION_STATUS_COLORS[status] }}
                    aria-hidden
                  />
                  {EXECUTION_STATUS_LABELS[status]}
                  <span className="font-medium tabular-nums text-foreground">
                    {countFor(stats, status)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
