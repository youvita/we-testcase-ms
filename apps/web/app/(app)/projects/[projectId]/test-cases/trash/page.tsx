import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageTour } from "@/components/coach-marks/tours";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { TrashPanel } from "@/features/test-cases/components/trash-panel";
import { canManageTestCases } from "@/lib/permissions";
import { requireProjectAccess } from "@/lib/project-access";
import { requireUser } from "@/lib/session";
import { getProject } from "@/services/project.service";
import { listTrash } from "@/services/test-case.service";

export const metadata: Metadata = { title: "Trash" };

/** Deleted test cases, until someone restores them or deletes them forever. */
export default async function TrashPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  await requireProjectAccess(projectId, user);

  const project = await getProject(projectId).catch(() => null);
  if (!project) notFound();

  const items = await listTrash(projectId);

  return (
    <div className="space-y-6">
      <PageTour page="trash" userId={user.id} />
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Trash" },
        ]}
      />

      <PageHeader
        title="Trash"
        description="Deleted test cases stay here with their history, comments and scripts until someone restores them or deletes them forever. Their TC IDs stay taken meanwhile."
      />

      <div data-tour="trash-list">
        <TrashPanel
          projectId={projectId}
          items={items}
          canManage={canManageTestCases(user.role)}
        />
      </div>
    </div>
  );
}
