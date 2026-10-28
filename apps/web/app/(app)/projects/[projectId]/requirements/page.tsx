import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CircleHelp,
  FileCheck2,
  FileText,
  FileWarning,
  Sparkles,
} from "lucide-react";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { RequirementsWorkspace } from "@/features/requirements/components/requirements-workspace";
import { canManageTestCases } from "@/lib/permissions";
import { requireProjectAccess } from "@/lib/project-access";
import { requireUser } from "@/lib/session";
import { listJobs } from "@/services/ai-job.service";
import { listSignInCases } from "@/services/automation-script.service";
import { listRunEnvironments } from "@/services/run-environment.service";
import { getProject } from "@/services/project.service";
import {
  listRequirementDocs,
  listRequirements,
} from "@/services/requirement.service";
import { listPendingDrafts } from "@/services/test-case-draft.service";

export const metadata: Metadata = { title: "Requirements" };

const REQUIREMENT_JOB_KINDS = ["EXTRACT_REQUIREMENTS", "GENERATE_TEST_CASES", "EXPLORE_APP"] as const;

export default async function RequirementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ explore?: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  await requireProjectAccess(projectId, user);

  const project = await getProject(projectId).catch(() => null);
  if (!project) notFound();

  const [docs, requirements, drafts, jobs, environments, signInCases, { explore }] = await Promise.all([
    listRequirementDocs(projectId),
    listRequirements(projectId),
    listPendingDrafts(projectId),
    listJobs(projectId, { kinds: [...REQUIREMENT_JOB_KINDS] }),
    listRunEnvironments(projectId),
    listSignInCases(projectId),
    searchParams,
  ]);

  const covered = requirements.filter((req) => req.testCases.length > 0).length;
  const withQuestions = requirements.filter((req) => req.openQuestions).length;
  const coverage = requirements.length
    ? Math.round((covered / requirements.length) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Requirements" },
        ]}
      />

      <PageHeader
        title="Requirements"
        description="Upload the PRD or FRD, let the AI read it into requirements, then draft and review test cases that trace back to them."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Requirements"
          value={requirements.length}
          icon={FileText}
          hint={`${docs.length} document${docs.length === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Covered by tests"
          value={`${coverage}%`}
          tone="passed"
          icon={FileCheck2}
          hint={`${covered} of ${requirements.length}`}
        />
        <StatCard
          label="Not covered"
          value={requirements.length - covered}
          tone={requirements.length - covered > 0 ? "failed" : undefined}
          icon={FileWarning}
        />
        <StatCard
          label="Open questions"
          value={withQuestions}
          tone={withQuestions > 0 ? "blocked" : undefined}
          icon={CircleHelp}
          hint={drafts.length > 0 ? `${drafts.length} drafts to review` : undefined}
        />
      </div>

      <RequirementsWorkspace
        projectId={projectId}
        docs={docs}
        requirements={requirements}
        drafts={drafts}
        jobs={jobs}
        platforms={project.platforms}
        canManage={canManageTestCases(user.role)}
        environments={environments}
        signInCases={signInCases}
        openExplore={explore === "1" && canManageTestCases(user.role)}
      />

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="size-3.5" />
        AI runs on the Claude subscription of whoever starts it. Nothing it
        writes becomes a test case until someone accepts it.
      </p>
    </div>
  );
}
