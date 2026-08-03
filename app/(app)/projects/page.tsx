import type { Metadata } from "next";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { ProjectList } from "@/features/projects/components/project-list";
import { ROLES } from "@/lib/constants";
import { canManageProjects } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import {
  listProjects,
  listQaOwnerCandidates,
} from "@/services/project.service";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const user = await requireUser();

  const [projects, qaOwners] = await Promise.all([
    listProjects(),
    // Only fetch the owner list when the user can actually assign one.
    canManageProjects(user.role) ? listQaOwnerCandidates() : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Projects" }]} />

      <PageHeader
        title="Projects"
        description={
          canManageProjects(user.role)
            ? "Create a project, import Excel test cases, then execute them online."
            : "Projects you can review. Test data is read-only for your role."
        }
      />

      <ProjectList
        projects={projects}
        qaOwners={qaOwners}
        canManage={canManageProjects(user.role)}
        canDelete={user.role === ROLES.ADMIN}
      />
    </div>
  );
}
