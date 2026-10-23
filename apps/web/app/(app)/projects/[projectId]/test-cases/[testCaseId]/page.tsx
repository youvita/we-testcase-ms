import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import {
  PlatformBadge,
  PriorityBadge,
  TestTypeBadge,
} from "@/components/shared/priority-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { CommentThread } from "@/features/comments/components/comment-thread";
import { FixStatusPanel } from "@/features/comments/components/fix-status-panel";
import { ExecutionEditorProvider } from "@/features/executions/components/execution-editor-context";
import { FixTimeline } from "@/features/executions/components/fix-timeline";
import { RecordResultButton } from "@/features/executions/components/record-result-button";
import { RetestButton } from "@/features/executions/components/retest-button";
import { ExecutionHistory } from "@/features/executions/components/execution-history";
import { ExecutionPanel } from "@/features/executions/components/execution-panel";
import { AutomationScriptCard } from "@/features/automation/components/automation-script-card";
import { TestCaseDetailShell } from "@/features/executions/components/test-case-detail-shell";
import {
  canComment,
  canExecuteTests,
  canManageTestCases,
  canMarkRetesting,
  canSetFixStatus,
  isAdmin,
} from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  hasTestCaseAccess,
  requireProjectAccess,
} from "@/lib/project-access";
import { getSessionUser, requireUser } from "@/lib/session";
import { getJob } from "@/services/ai-job.service";
import { getLatestScriptJob } from "@/services/ai-scripts.service";
import { getAutomationScript, listSignInCases } from "@/services/automation-script.service";
import { listComments } from "@/services/comment.service";
import { listRunEnvironments } from "@/services/run-environment.service";
import {
  getTestCase,
  getTestCaseNeighbours,
} from "@/services/test-case.service";
import { formatDateTime } from "@/utils/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ testCaseId: string }>;
}): Promise<Metadata> {
  const { testCaseId } = await params;

  // Same reason as the project page: the tab title must not name a case the
  // viewer is not allowed to open.
  const user = await getSessionUser();
  if (!(await hasTestCaseAccess(testCaseId, user))) {
    return { title: "Test Case" };
  }

  try {
    const testCase = await getTestCase(testCaseId);
    return { title: `${testCase.tcId} — ${testCase.title}` };
  } catch {
    return { title: "Test Case" };
  }
}

export default async function TestCaseDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; testCaseId: string }>;
}) {
  const user = await requireUser();
  const { projectId, testCaseId } = await params;
  await requireProjectAccess(projectId, user);

  const testCase = await getTestCase(testCaseId).catch(() => null);
  if (!testCase) notFound();

  // Guard against a test case id from a different project appearing under this
  // project's URL.
  if (testCase.projectId !== projectId) notFound();

  const [neighbours, comments, script, environments, lastRunItem, latestWrite, signInCases] = await Promise.all([
    getTestCaseNeighbours(projectId, testCase.tcId),
    listComments(testCaseId),
    getAutomationScript(testCaseId),
    listRunEnvironments(projectId),
    prisma.testRunItem.findFirst({
      // Only results that ran — a skip from a cancelled run is not a result.
      where: {
        testCaseId,
        status: { in: ["PASSED", "FAILED", "ERROR"] },
        run: { purpose: "RUN" },
      },
      orderBy: { finishedAt: "desc" },
      select: { status: true, finishedAt: true, run: { select: { id: true, number: true } } },
    }),
    getLatestScriptJob(testCaseId),
    listSignInCases(projectId),
  ]);
  const latestWriteJob = latestWrite ? await getJob(latestWrite.id) : null;

  const canExecute = canExecuteTests(user.role);

  /**
   * The fix pipeline only makes sense once something has gone wrong. A case
   * that has never failed has no failure to track, and one that passed a retest
   * still deserves to show the completed run.
   */
  const showTimeline =
    testCase.status === "FAILED" ||
    testCase.status === "BLOCKED" ||
    testCase.fixStatus !== "NONE" ||
    testCase.executions.some(
      (execution) =>
        execution.status === "FAILED" || execution.status === "BLOCKED",
    );
  const canPostComment = canComment(user.role);
  /**
   * Triage answers a failure, so the panel appears only while there is one to
   * answer — plus whenever a flag is already set, so it can still be cleared.
   * A passed case has nothing for a developer to say here.
   */
  const needsTriage =
    testCase.status === "FAILED" ||
    testCase.status === "BLOCKED" ||
    testCase.fixStatus !== "NONE";
  const canTriage = canSetFixStatus(user.role) && needsTriage;
  const canRetest = canMarkRetesting(user.role);

  const details: { label: string; value: string | null }[] = [
    { label: "Preconditions", value: testCase.preconditions },
    { label: "Steps", value: testCase.steps },
    { label: "Expected result", value: testCase.expectedResult },
  ];

  return (
    <ExecutionEditorProvider>
      <TestCaseDetailShell
        header={
          <>
            <Breadcrumbs
              items={[
                { label: "Projects", href: "/projects" },
                {
                  label: testCase.project.name,
                  href: `/projects/${projectId}`,
                },
                {
                  label: "Test Cases",
                  href: `/projects/${projectId}/test-cases`,
                },
                { label: testCase.tcId },
              ]}
            />

            <PageHeader
              title={testCase.title}
              description={`${testCase.tcId} · ${testCase.module.name}${testCase.subModule ? ` › ${testCase.subModule}` : ""}`}
              actions={
                <div className="flex items-center gap-2">
                  {canExecute && <RecordResultButton />}

                  {neighbours.prevId ? (
                    <Button variant="outline" size="icon" asChild>
                      <Link
                        href={`/projects/${projectId}/test-cases/${neighbours.prevId}`}
                        aria-label="Previous test case"
                      >
                        <ChevronLeft className="size-4" />
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="icon"
                      disabled
                      aria-label="Previous test case"
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                  )}

                  {neighbours.nextId ? (
                    <Button variant="outline" size="icon" asChild>
                      <Link
                        href={`/projects/${projectId}/test-cases/${neighbours.nextId}`}
                        aria-label="Next test case"
                      >
                        <ChevronRight className="size-4" />
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="icon"
                      disabled
                      aria-label="Next test case"
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  )}
                </div>
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={testCase.status} />
                <TestTypeBadge testType={testCase.testType} />
                <PriorityBadge priority={testCase.priority} />
                <PlatformBadge platform={testCase.platform} />
                {testCase.lastExecutedAt && (
                  <span className="text-xs text-muted-foreground">
                    · Last executed {formatDateTime(testCase.lastExecutedAt)}
                  </span>
                )}
              </div>
            </PageHeader>
          </>
        }
        left={
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Test case</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {details.every((detail) => !detail.value) ? (
                  <p className="text-sm text-muted-foreground">
                    This test case has no preconditions, steps or expected
                    result recorded. They may have been missing from the
                    imported sheet.
                  </p>
                ) : (
                  details.map((detail) =>
                    detail.value ? (
                      <div key={detail.label} className="space-y-1.5">
                        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {detail.label}
                        </h3>
                        <p className="preserve-lines text-sm">{detail.value}</p>
                      </div>
                    ) : null,
                  )
                )}
                {testCase.requirements.length > 0 && (
                  <div className="space-y-1.5">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Verifies requirements
                    </h3>
                    <ul className="space-y-1 text-sm">
                      {testCase.requirements.map(({ requirement }) => (
                        <li key={requirement.id}>
                          <Link
                            href={`/projects/${projectId}/requirements`}
                            className="hover:underline"
                          >
                            <span className="font-mono text-xs">
                              {requirement.code}
                            </span>{" "}
                            {requirement.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            <AutomationScriptCard
              projectId={projectId}
              testCaseId={testCase.id}
              platform={testCase.platform}
              canManage={canManageTestCases(user.role)}
              environments={environments}
              script={
                script && {
                  code: script.code,
                  updatedAt: script.updatedAt.toISOString(),
                  verifiedAt: script.verifiedAt?.toISOString() ?? null,
                  updatedBy: script.updatedBy,
                }
              }
              latestWriteJob={latestWriteJob}
              signInCases={signInCases.filter((c) => c.id !== testCase.id)}
              lastResult={
                lastRunItem && {
                  status: lastRunItem.status,
                  runId: lastRunItem.run.id,
                  runNumber: lastRunItem.run.number,
                  finishedAt: lastRunItem.finishedAt?.toISOString() ?? null,
                }
              }
            />

            <ExecutionHistory
              projectId={projectId}
              executions={testCase.executions}
              currentUserId={user.id}
              canModerate={isAdmin(user.role)}
            />
          </>
        }
        right={
          <>
            {canExecute && (
              <ExecutionPanel
                testCaseId={testCase.id}
                currentStatus={testCase.status}
              />
            )}

            {canTriage && (
              <FixStatusPanel
                testCaseId={testCase.id}
                fixStatus={testCase.fixStatus}
                fixStatusAt={testCase.fixStatusAt}
                fixStatusBy={testCase.fixStatusBy}
              />
            )}

            {showTimeline && (
              <FixTimeline
                status={testCase.status}
                fixStatus={testCase.fixStatus}
                executions={testCase.executions}
                events={testCase.fixStatusEvents}
                fixStatusBy={testCase.fixStatusBy}
                fixStatusAt={testCase.fixStatusAt}
                action={
                  canRetest ? (
                    <RetestButton
                      testCaseId={testCase.id}
                      fixStatus={testCase.fixStatus}
                      claimedBy={testCase.fixStatusBy}
                      claimedAt={testCase.fixStatusAt}
                      currentUserId={user.id}
                    />
                  ) : undefined
                }
              />
            )}

            <CommentThread
              testCaseId={testCase.id}
              comments={comments}
              currentUserId={user.id}
              canComment={canPostComment}
              canModerate={isAdmin(user.role)}
            />
          </>
        }
      />
    </ExecutionEditorProvider>
  );
}
