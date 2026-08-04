import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BugPlay,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  ClipboardList,
  ListChecks,
  XCircle,
} from "lucide-react";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { ProjectStatusBadge } from "@/components/shared/priority-badge";
import { StatCard } from "@/components/shared/stat-card";
import { DailyExecutionChart } from "@/features/dashboard/components/daily-execution-chart";
import { ModuleProgressList } from "@/features/dashboard/components/module-progress-list";
import { StatusDonut } from "@/features/dashboard/components/status-donut";
import { ModuleManager } from "@/features/modules/components/module-manager";
import { ExportMenu } from "@/features/reports/components/export-menu";
import { canManageProjects } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getProjectDashboard } from "@/services/dashboard.service";
import { listModules } from "@/services/module.service";
import { getProject } from "@/services/project.service";
import { formatDate } from "@/utils/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await params;
  try {
    const project = await getProject(projectId);
    return { title: project.name };
  } catch {
    return { title: "Project" };
  }
}

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;

  const project = await getProject(projectId).catch(() => null);
  if (!project) notFound();

  const [dashboard, modules] = await Promise.all([
    getProjectDashboard(projectId),
    listModules(projectId),
  ]);

  const { stats } = dashboard;
  const problemCount = stats.failed + stats.blocked;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name },
        ]}
      />

      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
        actions={
          <>
            <ExportMenu projectId={projectId} format="pdf" />
            <Button variant="outline" asChild>
              <Link href={`/projects/${projectId}/failed`}>
                <BugPlay className="mr-2 size-4" />
                Failed &amp; blocked
                {problemCount > 0 && (
                  <span className="ml-2 rounded-full bg-destructive/10 px-1.5 text-xs font-semibold text-destructive">
                    {problemCount}
                  </span>
                )}
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/projects/${projectId}/test-cases`}>
                <ListChecks className="mr-2 size-4" />
                Test cases
              </Link>
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <ProjectStatusBadge status={project.status} />
          {project.version && <span>Version {project.version}</span>}
          {project.environment && <span>{project.environment}</span>}
          <span>QA owner: {project.qaOwner?.name ?? "Unassigned"}</span>
          {(project.startDate || project.endDate) && (
            <span>
              {formatDate(project.startDate)} – {formatDate(project.endDate)}
            </span>
          )}
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard
          label="Test cases"
          value={stats.total}
          icon={ClipboardList}
          hint={`${modules.length} module${modules.length === 1 ? "" : "s"}`}
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
        <StatCard
          label="Execution"
          value={`${stats.executionRate}%`}
          hint={`Pass rate ${stats.passRate}%`}
        />
      </div>

      {/* Both cards are direct grid children so the grid's default stretch
          makes them share a row height — wrapping either one in a <div> would
          stretch the wrapper and leave the card itself short. */}
      <div className="grid gap-6 lg:grid-cols-3">
        <StatusDonut stats={stats} />
        <DailyExecutionChart
          data={dashboard.daily}
          className="lg:col-span-2"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ModuleProgressList modules={dashboard.moduleProgress} />

        <ModuleManager
          projectId={projectId}
          modules={modules.map((mod) => ({
            id: mod.id,
            name: mod.name,
            description: mod.description,
            testCaseCount: mod._count.testCases,
          }))}
          canManage={canManageProjects(user.role)}
        />
      </div>

      {stats.total === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Get started</CardTitle>
            <CardDescription>
              This project has no test cases yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/projects/${projectId}/test-cases`}>
                Import Excel test cases
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/api/import-template?projectId=${projectId}`}>
                Download a template
              </a>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
