"use client";

import { isValid, parse } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  EXECUTION_STATUS_COLORS,
  EXECUTION_STATUS_LABELS,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { DailyExecutionPoint } from "@/types";

const SERIES = [
  {
    key: "passed",
    label: EXECUTION_STATUS_LABELS.PASSED,
    color: EXECUTION_STATUS_COLORS.PASSED,
  },
  {
    key: "failed",
    label: EXECUTION_STATUS_LABELS.FAILED,
    color: EXECUTION_STATUS_COLORS.FAILED,
  },
  {
    key: "blocked",
    label: EXECUTION_STATUS_LABELS.BLOCKED,
    color: EXECUTION_STATUS_COLORS.BLOCKED,
  },
] as const satisfies readonly {
  key: keyof Pick<DailyExecutionPoint, "passed" | "failed" | "blocked">;
  label: string;
  color: string;
}[];

const AXIS_COLOR = "hsl(var(--muted-foreground))";
const GRID_COLOR = "hsl(var(--border))";

/**
 * "2026-07-29" -> "29 Jul". Parsed with an explicit format so an unexpected
 * value degrades to the raw string instead of "Invalid Date".
 */
function formatAxisDate(value: string): string {
  if (typeof value !== "string") return "";
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  if (!isValid(parsed)) return value;
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = parsed.toLocaleString("en-US", { month: "short" });
  return `${day} ${month}`;
}

type ChartTooltipProps = {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ dataKey?: string | number; value?: number | string }>;
};

function ChartTooltip({ active, label, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const rows = SERIES.map((series) => {
    const entry = payload.find((item) => item.dataKey === series.key);
    const raw = entry?.value;
    const value = typeof raw === "number" ? raw : Number(raw ?? 0);
    return { ...series, value: Number.isFinite(value) ? value : 0 };
  }).filter((row) => row.value > 0);

  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="min-w-[9rem] rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium text-card-foreground">
        {formatAxisDate(typeof label === "string" ? label : String(label ?? ""))}
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No executions</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
                aria-hidden
              />
              <span className="text-muted-foreground">{row.label}</span>
              <span className="ml-auto font-medium tabular-nums text-card-foreground">
                {row.value}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex items-center gap-2 border-t pt-1.5">
        <span className="text-muted-foreground">Total</span>
        <span className="ml-auto font-medium tabular-nums text-card-foreground">
          {total}
        </span>
      </div>
    </div>
  );
}

/** Stacked bars of pass/fail/blocked executions per day. */
export function DailyExecutionChart({
  data,
  className,
}: {
  data: DailyExecutionPoint[];
  className?: string;
}) {
  const hasExecutions = data.some((point) => point.total > 0);

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardTitle>Daily Executions</CardTitle>
        <CardDescription>Executions recorded per day</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {!hasExecutions ? (
          <div className="flex min-h-[240px] flex-1 items-center justify-center text-sm text-muted-foreground">
            No executions recorded in the last 14 days
          </div>
        ) : (
          // `flex-1` lets the plot absorb the height the taller neighbouring
          // card sets, so aligning the two bottoms leaves no dead space here.
          // `min-h` is the floor that keeps ResponsiveContainer measurable when
          // the row height is content-driven instead (single-column layout).
          <div className="min-h-[240px] w-full flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                barCategoryGap="22%"
              >
                <CartesianGrid
                  vertical={false}
                  stroke={GRID_COLOR}
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatAxisDate}
                  tickLine={false}
                  axisLine={{ stroke: GRID_COLOR }}
                  tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                  interval="preserveStartEnd"
                  minTickGap={8}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                  width={40}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ fill: GRID_COLOR, fillOpacity: 0.35 }}
                />
                {SERIES.map((series, index) => (
                  <Bar
                    key={series.key}
                    dataKey={series.key}
                    name={series.label}
                    stackId="executions"
                    fill={series.color}
                    isAnimationActive={false}
                    radius={
                      index === SERIES.length - 1 ? [3, 3, 0, 0] : undefined
                    }
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
