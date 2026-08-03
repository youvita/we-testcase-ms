import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PartyPopper } from "lucide-react";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import {
  PriorityBadge,
  TestTypeBadge,
} from "@/components/shared/priority-badge";
import { FixStatusBadge } from "@/components/shared/fix-status-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { AttachmentGallery } from "@/features/executions/components/attachment-gallery";
import { ExportMenu } from "@/features/reports/components/export-menu";
import { requireUser } from "@/lib/session";
import { getProject } from "@/services/project.service";
import { listFailedTestCases } from "@/services/test-case.service";
import { formatDateTime } from "@/utils/format";

export const metadata: Metadata = { title: "Failed & Blocked" };

/**
 * The Developer portal's main view: every failing or blocked case with the
 * expected vs actual result, the QA comment and the screenshots — everything a
 * developer needs to act, with no way to change the test data.
 */
export default async function FailedCasesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  await requireUser();
  const { projectId } = await params;

  const project = await getProject(projectId).catch(() => null);
  if (!project) notFound();

  const cases = await listFailedTestCases(projectId);

  const failed = cases.filter((c) => c.status === "FAILED").length;
  const blocked = cases.filter((c) => c.status === "BLOCKED").length;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project.name, href: `/projects/${projectId}` },
          { label: "Failed & Blocked" },
        ]}
      />

      <PageHeader
        title="Failed & blocked cases"
        description={
          cases.length === 0
            ? "Nothing is failing in this project."
            : `${failed} failed and ${blocked} blocked, grouped by test type.`
        }
        actions={<ExportMenu projectId={projectId} excelScope="failed" />}
      />

      {cases.length === 0 ? (
        <EmptyState
          icon={PartyPopper}
          title="Nothing is failing"
          description="No test case in this project is currently marked failed or blocked."
          action={
            <Button variant="outline" asChild>
              <Link href={`/projects/${projectId}/test-cases`}>
                View all test cases
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {cases.map((testCase) => {
            const latest = testCase.executions[0];

            return (
              <Card key={testCase.id}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <Link
                        href={`/projects/${projectId}/test-cases/${testCase.id}`}
                        className="block font-medium hover:underline"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {testCase.tcId}
                        </span>{" "}
                        {testCase.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {testCase.module.name}
                        {latest && (
                          <>
                            {" · "}
                            {latest.tester.name}
                            {" · "}
                            {formatDateTime(latest.executedAt)}
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <TestTypeBadge testType={testCase.testType} />
                      <PriorityBadge priority={testCase.priority} />
                      <StatusBadge status={testCase.status} />
                      <FixStatusBadge fixStatus={testCase.fixStatus} />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Expected result
                      </h3>
                      <p className="preserve-lines text-sm">
                        {testCase.expectedResult ?? "—"}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Actual result
                      </h3>
                      <p className="preserve-lines text-sm">
                        {latest?.actualResult ?? "—"}
                      </p>
                    </div>
                  </div>

                  {latest?.comment && (
                    <div className="space-y-1.5 rounded-md bg-muted/50 p-3">
                      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        QA comment
                      </h3>
                      <p className="preserve-lines text-sm">{latest.comment}</p>
                    </div>
                  )}

                  {latest && latest.attachments.length > 0 && (
                    <div className="space-y-1.5">
                      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Attachments
                      </h3>
                      <AttachmentGallery attachments={latest.attachments} />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
