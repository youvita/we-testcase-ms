import dynamic from "next/dynamic";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DailyExecutionPoint } from "@/types";

const DailyExecutionChartClient = dynamic(() =>
  import("./daily-execution-chart-client").then(
    (mod) => mod.DailyExecutionChartClient,
  ),
);

/** Daily executions card. Recharts is not loaded until there is data to plot. */
export function DailyExecutionChart({
  data,
  className,
}: {
  data: DailyExecutionPoint[];
  className?: string;
}) {
  const hasExecutions = data.some((point) => point.total > 0);

  if (!hasExecutions) {
    return (
      <Card className={cn("flex flex-col", className)}>
        <CardHeader>
          <CardTitle>Daily Executions</CardTitle>
          <CardDescription>Executions recorded per day</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          <div className="flex min-h-[240px] flex-1 items-center justify-center text-sm text-muted-foreground">
            No executions recorded in the last 14 days
          </div>
        </CardContent>
      </Card>
    );
  }

  return <DailyExecutionChartClient data={data} className={className} />;
}
