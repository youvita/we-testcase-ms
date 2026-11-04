import type { Metadata } from "next";
import Link from "next/link";
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
import { getLastFinishedRun, listTestRunsPage } from "@/services/test-run.service";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";

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

  const [runs, lastFinished, environments, modules, subModules, automatedCount, automatableCount, signInCases] = await Promise.all([
    // The first page; the table fetches the others itself.
    listTestRunsPage(projectId, { page: 1, pageSize: DEFAULT_PAGE_SIZE }),
    // From all runs, not this page: page 3 must not change the "last run" cards.
    getLastFinishedRun(projectId),
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
        description="Run Playwright scripts for Web and API test cases against one of the project's environments. Results land on the test cases with screenshots and traces."
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
        {/* Environments have their own page; the card is the way there. */}
        <Link
          href={`/projects/${projectId}/environments`}
          className="rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label="Environments"
            value={environments.length}
            icon={Server}
            hint={environments.find((env) => env.isDefault)?.name.concat(" is the default") ?? "Manage"}
            className="h-full"
          />
        </Link>
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
