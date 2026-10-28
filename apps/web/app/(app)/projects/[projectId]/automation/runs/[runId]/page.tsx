import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { RunDetail } from "@/features/automation/components/run-detail";
import { canManageTestCases } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { requireProjectAccess } from "@/lib/project-access";
import { requireUser } from "@/lib/session";
import { getProject } from "@/services/project.service";
import { getTestRun } from "@/services/test-run.service";

export const metadata: Metadata = { title: "Run" };

export default async function RunPage({
  params,
}: {
  params: Promise<{ projectId: string; runId: string }>;
}) {
  const user = await requireUser();
  const { projectId, runId } = await params;
  await requireProjectAccess(projectId, user);

  const [project, run] = await Promise.all([
    getProject(projectId).catch(() => null),
    getTestRun(runId).catch(() => null),
  ]);
  if (!project || !run) notFound();

  // A run id from another project must not render under this one.
  const belongs = await prisma.testRun.count({ where: { id: runId, projectId } });
  if (!belongs) notFound();

  const title = run.number ? `Run #${run.number}` : "Script check";
  // A script check tries one case's script while it is being written: it
  // belongs under that case, which is where the way back should lead.
  const checkedCase =
    run.purpose === "SCRIPT_CHECK" && run.items.length === 1 ? run.items[0]!.testCase : null;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          ...(checkedCase
            ? [
                { label: "Test Cases", href: `/projects/${projectId}/test-cases` },
                {
                  label: checkedCase.tcId,
                  href: `/projects/${projectId}/test-cases/${checkedCase.id}`,
                },
              ]
            : [{ label: "Automation", href: `/projects/${projectId}/automation` }]),
          { label: title },
        ]}
      />
      <PageHeader
        title={title}
        description={
          run.purpose === "SCRIPT_CHECK"
            ? "The AI tried a draft script here while writing it. Nothing was recorded on the test case."
            : undefined
        }
      />
      <RunDetail projectId={projectId} run={run} canManage={canManageTestCases(user.role)} />
    </div>
  );
}
