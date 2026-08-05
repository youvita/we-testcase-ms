import type { Metadata } from "next";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { ExportMenu } from "@/features/reports/components/export-menu";
import { TestCaseFilters } from "@/features/test-cases/components/test-case-filters";
import { TestCaseTable } from "@/features/test-cases/components/test-case-table";
import { TestCaseToolbar } from "@/features/test-cases/components/test-case-toolbar";
import { canManageTestCases } from "@/lib/permissions";
import { requireProjectAccess } from "@/lib/project-access";
import { requireUser } from "@/lib/session";
import { testCaseQuerySchema } from "@/lib/validations";
import { listModules } from "@/services/module.service";
import { getProject } from "@/services/project.service";
import { listTestCases } from "@/services/test-case.service";

export const metadata: Metadata = { title: "Test Cases" };

export default async function TestCasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  await requireProjectAccess(projectId, user);
  const rawSearchParams = await searchParams;

  // Drop blank and "ALL" sentinels so the schema's defaults apply.
  const normalized = Object.fromEntries(
    Object.entries(rawSearchParams)
      .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
      .filter(([, value]) => value !== undefined && value !== "" && value !== "ALL"),
  );

  const query = testCaseQuerySchema.parse(normalized);

  const [project, modules, page] = await Promise.all([
    getProject(projectId),
    listModules(projectId),
    listTestCases(projectId, query),
  ]);

  const canManage = canManageTestCases(user.role);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Test Cases" },
        ]}
      />

      <PageHeader
        title="Test Cases"
        description={`${page.total} test case${page.total === 1 ? "" : "s"} in ${project.name}`}
        actions={
          <>
            <ExportMenu projectId={projectId} excelScope="cases" />
            {canManage && (
              <TestCaseToolbar
                projectId={projectId}
                modules={modules.map((m) => ({ id: m.id, name: m.name }))}
              />
            )}
          </>
        }
      />

      <TestCaseFilters
        modules={modules.map((m) => ({ id: m.id, name: m.name }))}
      />

      <TestCaseTable
        projectId={projectId}
        page={page}
        modules={modules.map((m) => ({ id: m.id, name: m.name }))}
        canManage={canManage}
      />
    </div>
  );
}
