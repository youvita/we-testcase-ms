import { LayersIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import {
  StatusMeter,
  StatusMeterLegend,
} from "@/components/shared/progress-meter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ModuleProgress, StatusBreakdown } from "@/types";
import { formatPercent } from "@/utils/format";

/** Roll the per-module counts up so one legend can describe the whole list. */
function aggregate(modules: ModuleProgress[]): StatusBreakdown {
  const totals = modules.reduce(
    (acc, module) => ({
      total: acc.total + module.total,
      passed: acc.passed + module.passed,
      failed: acc.failed + module.failed,
      blocked: acc.blocked + module.blocked,
      notRun: acc.notRun + module.notRun,
    }),
    { total: 0, passed: 0, failed: 0, blocked: 0, notRun: 0 },
  );

  const executed = totals.total - totals.notRun;

  return {
    ...totals,
    executed,
    executionRate:
      totals.total > 0 ? Math.round((executed / totals.total) * 100) : 0,
    passRate: executed > 0 ? Math.round((totals.passed / executed) * 100) : 0,
  };
}

/**
 * Per-module execution progress, least complete first so the modules that need
 * attention are at the top. Purely presentational — safe as a server component.
 */
export function ModuleProgressList({
  modules,
  className,
}: {
  modules: ModuleProgress[];
  className?: string;
}) {
  // Stable ordering: lowest execution rate first, then fewest executed, then
  // by name so equal modules never shuffle between renders.
  const sorted = [...modules].sort((a, b) => {
    if (a.executionRate !== b.executionRate) {
      return a.executionRate - b.executionRate;
    }
    if (a.executed !== b.executed) return a.executed - b.executed;
    return a.moduleName.localeCompare(b.moduleName);
  });

  const totals = aggregate(modules);

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <CardTitle>Module Progress</CardTitle>
        <CardDescription>
          {modules.length > 0
            ? `${modules.length} module${modules.length === 1 ? "" : "s"} · least complete first`
            : "No modules yet"}
        </CardDescription>
        {modules.length > 0 && (
          <StatusMeterLegend stats={totals} className="pt-1" />
        )}
      </CardHeader>
      <CardContent className="flex-1">
        {sorted.length === 0 ? (
          <EmptyState
            icon={LayersIcon}
            title="No modules yet"
            description="Modules appear here once test cases have been imported or created."
          />
        ) : (
          <ul className="space-y-4">
            {sorted.map((module) => (
              <li key={module.moduleId} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">
                    {module.moduleName}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {module.executed}/{module.total}
                    <span className="ml-2 font-medium text-foreground">
                      {formatPercent(module.executionRate)}
                    </span>
                  </span>
                </div>
                <StatusMeter stats={module} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
