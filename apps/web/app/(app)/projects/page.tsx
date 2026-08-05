import type { Metadata } from "next";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { ProjectList } from "@/features/projects/components/project-list";
import { ROLES } from "@/lib/constants";
import { canManageProjects } from "@/lib/permissions";
import { projectAccessWhere } from "@/lib/project-access";
import { requireUser } from "@/lib/session";
import {
  listEnvironmentOptions,
  listProjectMemberCandidates,
  listProjects,
  listQaOwnerCandidates,
} from "@/services/project.service";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const user = await requireUser();
  const canManage = canManageProjects(user.role);

  const [projects, qaOwners, memberCandidates, environments] =
    await Promise.all([
      // Only the projects this person is on — see lib/project-access.ts.
      listProjects({ access: projectAccessWhere(user) }),
      // The rest only feed the create/edit form, so they are fetched only for
      // the roles that get one.
      canManage ? listQaOwnerCandidates() : Promise.resolve([]),
      canManage ? listProjectMemberCandidates() : Promise.resolve([]),
      canManage ? listEnvironmentOptions() : Promise.resolve([]),
    ]);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Projects" }]} />

      <PageHeader
        title="Projects"
        description={
          canManage
            ? "Create a project, import Excel test cases, then execute them online."
            : "Projects you are in charge of. Test data is read-only for your role."
        }
      />

      <ProjectList
        projects={projects}
        qaOwners={qaOwners}
        memberCandidates={memberCandidates}
        environments={environments}
        canManage={canManage}
        canDelete={user.role === ROLES.ADMIN}
      />
    </div>
  );
}
