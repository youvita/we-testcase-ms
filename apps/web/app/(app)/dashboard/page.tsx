import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  ClipboardList,
  FolderKanban,
  Plus,
  XCircle,
} from "lucide-react";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusMeter } from "@/components/shared/progress-meter";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { DailyExecutionChart } from "@/features/dashboard/components/daily-execution-chart";
import { StatusDonut } from "@/features/dashboard/components/status-donut";
import { canManageProjects } from "@/lib/permissions";
import { projectAccessWhere } from "@/lib/project-access";
import { requireUser } from "@/lib/session";
import {
  getDashboardSummary,
  getRecentActivity,
} from "@/services/dashboard.service";
import { listProjects } from "@/services/project.service";
import { formatRelative, initials } from "@/utils/format";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();

  // The project list comes first because everything else is scoped to it: the
  // dashboard must not count or name work in projects this person cannot open.
  const projects = await listProjects({ access: projectAccessWhere(user) });
  const projectIds = projects.map((project) => project.id);

  const [summary, activity] = await Promise.all([
    getDashboardSummary(projectIds),
    getRecentActivity(6, projectIds),
  ]);

  const { stats } = summary;

  // Busiest projects first — the ones with test cases are the ones worth showing.
  const topProjects = [...projects]
    .sort((a, b) => b.stats.total - a.stats.total)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard" }]} />

      <PageHeader
        title={`Welcome back, ${user.name.split(" ")[0] ?? user.name}`}
        description="Execution progress across every project."
        actions={
          canManageProjects(user.role) ? (
            <Button asChild>
              <Link href="/projects">
                <Plus className="mr-2 size-4" />
                New project
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard
          label="Projects"
          value={summary.totalProjects}
          icon={FolderKanban}
          hint={`${summary.activeProjects} active`}
        />
        <StatCard
          label="Test cases"
          value={stats.total}
          icon={ClipboardList}
          hint={`${stats.executed} executed`}
        />
        <StatCard
          label="Passed"
          value={stats.passed}
          tone="passed"
          icon={CheckCircle2}
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          tone="failed"
          icon={XCircle}
        />
        <StatCard
          label="Blocked"
          value={stats.blocked}
          tone="blocked"
          icon={CircleSlash}
        />
        <StatCard
          label="Not run"
          value={stats.notRun}
          tone="notrun"
          icon={CircleDashed}
        />
      </div>

      {/* Both cards are direct grid children so the grid's default stretch
          makes them share a row height — wrapping either one in a <div> would
          stretch the wrapper and leave the card itself short. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <StatusDonut stats={stats} />
        <DailyExecutionChart
          data={summary.daily}
          className="lg:col-span-2"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project progress</CardTitle>
            <CardDescription>
              The five projects with the most test cases.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {topProjects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description={
                  canManageProjects(user.role)
                    ? "Create your first project to start tracking execution."
                    : "No projects have been shared with you yet."
                }
                action={
                  canManageProjects(user.role) ? (
                    <Button size="sm" asChild>
                      <Link href="/projects">Go to projects</Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="space-y-4">
                {topProjects.map((project) => (
                  <li key={project.id} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/projects/${project.id}`}
                        className="min-w-0 truncate text-sm font-medium hover:underline"
                      >
                        {project.name}
                      </Link>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                        {project.stats.executed}/{project.stats.total}
                        <span className="ml-2 font-semibold text-foreground">
                          {project.stats.executionRate}%
                        </span>
                      </span>
                    </div>
                    <StatusMeter stats={project.stats} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
            <CardDescription>The latest recorded results.</CardDescription>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No executions yet"
                description="Results appear here as soon as testing begins."
              />
            ) : (
              <ul className="space-y-3">
                {activity.map((execution) => (
                  <li key={execution.id} className="flex items-start gap-3">
                    <Avatar className="size-7 shrink-0">
                      <AvatarFallback className="text-xs">
                        {initials(execution.tester.name)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/projects/${execution.testCase.project.id}/test-cases/${execution.testCase.id}`}
                        className="block truncate text-sm hover:underline"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {execution.testCase.tcId}
                        </span>{" "}
                        {execution.testCase.title}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {execution.tester.name} ·{" "}
                        {execution.testCase.project.name} ·{" "}
                        {formatRelative(execution.executedAt)}
                      </p>
                    </div>

                    <StatusBadge
                      status={execution.status}
                      showIcon={false}
                      className="shrink-0"
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
