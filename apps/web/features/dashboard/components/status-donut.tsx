"use client";

import { PieChartIcon } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { useMounted } from "@/hooks/use-mounted";

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

/** Maps a status onto the matching count in the breakdown. */
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
 * Recharts hands the tooltip an untyped payload array, so keep the shape we
 * actually read narrow and guard the index access (noUncheckedIndexedAccess).
 */
type DonutTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: Slice }>;
  total: number;
};

function DonutTooltip({ active, payload, total }: DonutTooltipProps) {
  if (!active) return null;
  const slice = payload?.[0]?.payload;
  if (!slice) return null;

  const share = total > 0 ? (slice.value / total) * 100 : 0;

  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <div className="flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: slice.color }}
          aria-hidden
        />
        <span className="text-muted-foreground">{slice.label}:</span>
        <span className="font-medium tabular-nums text-card-foreground">
          {slice.value} ({formatPercent(share)})
        </span>
      </div>
    </div>
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
  const mounted = useMounted();
  // A zero-value slice would render a hairline artefact, so drop it entirely.
  const slices: Slice[] = EXECUTION_STATUSES.map((status) => ({
    status,
    label: EXECUTION_STATUS_LABELS[status],
    value: countFor(stats, status),
    color: EXECUTION_STATUS_COLORS[status],
  })).filter((slice) => slice.value > 0);
  // One slice + paddingAngle makes Recharts emit an invalid arc and React
  // throws — every current project is 100% NOT_RUN, so this is the live path.
  const paddingAngle = slices.length > 1 ? 2 : 0;

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
            {/* Recharts measures its parent: the wrapper needs a real height,
                otherwise ResponsiveContainer resolves to 0 and nothing paints. */}
            <div className="relative h-[240px] w-full">
              {mounted ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <PieChart>
                    <Pie
                      data={slices}
                      dataKey="value"
                      nameKey="label"
                      innerRadius={62}
                      outerRadius={92}
                      paddingAngle={paddingAngle}
                      strokeWidth={0}
                      isAnimationActive={false}
                    >
                      {slices.map((slice) => (
                        <Cell key={slice.status} fill={slice.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={<DonutTooltip total={stats.total} />}
                      cursor={false}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : null}

              {/* Centre overlay — positioned in CSS rather than as a Recharts
                  label so it stays crisp and inherits theme tokens. */}
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
