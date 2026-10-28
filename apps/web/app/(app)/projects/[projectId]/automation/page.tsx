import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Bot, CheckCircle2, Server, XCircle } from "lucide-react";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { AutomationWorkspace } from "@/features/automation/components/automation-workspace";
import { canManageTestCases } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireProjectAccess } from "@/lib/project-access";
import { isAutomationConfigured } from "@/lib/runner-auth";
import { requireUser } from "@/lib/session";
import { AUTOMATABLE_PLATFORMS } from "@wetestcase/dto";
import { listSignInCases } from "@/services/automation-script.service";
import { listModules } from "@/services/module.service";
import { listSubModules } from "@/services/test-case.service";
import { getProject } from "@/services/project.service";
import { listRunEnvironments } from "@/services/run-environment.service";
import { listTestRuns } from "@/services/test-run.service";

export const metadata: Metadata = { title: "Automation" };

export default async function AutomationPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  await requireProjectAccess(projectId, user);

  const project = await getProject(projectId).catch(() => null);
  if (!project) notFound();

  const [runs, environments, modules, subModules, automatedCount, automatableCount, signInCases] = await Promise.all([
    listTestRuns(projectId),
    listRunEnvironments(projectId),
    listModules(projectId),
    listSubModules(projectId),
    prisma.testCase.count({
      where: { projectId, script: { isNot: null }, platform: { in: [...AUTOMATABLE_PLATFORMS] } },
    }),
    prisma.testCase.count({
      where: { projectId, platform: { in: [...AUTOMATABLE_PLATFORMS] } },
    }),
    listSignInCases(projectId),
  ]);

  // A cancelled run says nothing about the product, so the stats skip it.
  const lastFinished = runs.find((run) => run.finishedAt && run.status !== "CANCELLED");

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Automation" },
        ]}
      />

      <PageHeader
        title="Automation"
        description="Run Playwright scripts for Web and API test cases against an environment. Results land on the test cases with screenshots and traces."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Automated cases"
          value={automatedCount}
          icon={Bot}
          hint={`of ${automatableCount} Web & API case${automatableCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Last run passed"
          value={lastFinished ? lastFinished.passed : "—"}
          tone="passed"
          icon={CheckCircle2}
          hint={lastFinished ? `Run #${lastFinished.number}` : undefined}
        />
        <StatCard
          label="Last run failed"
          value={lastFinished ? lastFinished.failed + lastFinished.errored : "—"}
          tone={lastFinished && lastFinished.failed + lastFinished.errored > 0 ? "failed" : undefined}
          icon={XCircle}
        />
        <StatCard label="Environments" value={environments.length} icon={Server} />
      </div>

      <AutomationWorkspace
        projectId={projectId}
        runs={runs}
        environments={environments}
        modules={modules.map((m) => ({ id: m.id, name: m.name }))}
        subModules={subModules}
        automatedCount={automatedCount}
        signInCases={signInCases}
        canManage={canManageTestCases(user.role)}
        runnerConfigured={isAutomationConfigured()}
      />
    </div>
  );
}
