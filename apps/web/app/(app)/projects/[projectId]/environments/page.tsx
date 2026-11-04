import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { EnvironmentsPanel } from "@/features/environments/components/environments-panel";
import { canManageTestCases } from "@/lib/permissions";
import { requireProjectAccess } from "@/lib/project-access";
import { requireUser } from "@/lib/session";
import { getProject } from "@/services/project.service";
import { listRunEnvironments } from "@/services/run-environment.service";

export const metadata: Metadata = { title: "Environments" };

/**
 * Where the project is tested: UAT, PRO and so on, with their URLs and test
 * accounts. Its own page rather than part of Automation, because manual
 * results and reports use environments too.
 */
export default async function EnvironmentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  await requireProjectAccess(projectId, user);

  const project = await getProject(projectId).catch(() => null);
  if (!project) notFound();

  const environments = await listRunEnvironments(projectId);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Environments" },
        ]}
      />

      <PageHeader
        title="Environments"
        description="Where this project is tested — base URLs, start page and test accounts. Scripts run against one, results record which, and the default is preselected everywhere."
      />

      <EnvironmentsPanel
        projectId={projectId}
        environments={environments}
        canManage={canManageTestCases(user.role)}
      />
    </div>
  );
}
