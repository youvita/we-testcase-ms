"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Download, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationControls } from "@/components/shared/pagination-controls";
import { api, errorMessage } from "@/utils/api-client";
import type { Paginated, RunEnvironmentDto, TestRunDto } from "@wetestcase/dto";
import type { SubModuleOption } from "@/types";
import { formatRelative } from "@/utils/format";
import { downloadProjectScripts } from "@/features/automation/download-scripts";

import { NoEnvironmentHint } from "@/features/environments/components/no-environment-hint";
import { NewRunDialog } from "./new-run-dialog";
import { RunStatusBadge, formatDuration, isRunActive } from "./run-status-badge";

const POLL_MS = 3000;

/**
 * Runs: start one, and follow the ones going. Environments live on their own
 * page — this only needs one to run against.
 */
export function AutomationWorkspace({
  projectId,
  runs: firstPage,
  environments,
  modules,
  subModules,
  automatedCount,
  signInCases,
  canManage,
  runnerConfigured,
}: {
  projectId: string;
  /** The first page of runs, newest first. */
  runs: Paginated<TestRunDto>;
  environments: RunEnvironmentDto[];
  modules: { id: string; name: string }[];
  subModules: SubModuleOption[];
  automatedCount: number;
  signInCases: { id: string; tcId: string; title: string }[];
  canManage: boolean;
  runnerConfigured: boolean;
}) {
  const router = useRouter();
  // Other pages are fetched here rather than navigated to: the first page
  // stays the server's, refreshed while runs are going, and paging never
  // reloads the page around the table.
  const [view, setView] = useState<{ page: number; pageSize: number }>({
    page: 1,
    pageSize: firstPage.pageSize,
  });
  const [fetched, setFetched] = useState<Paginated<TestRunDto> | null>(null);
  const [loading, setLoading] = useState(false);
  const onFirstPage = view.page === 1 && view.pageSize === firstPage.pageSize;
  const runs = onFirstPage || !fetched ? firstPage : fetched;

  async function showPage(page: number, pageSize: number) {
    setView({ page, pageSize });
    if (page === 1 && pageSize === firstPage.pageSize) return;
    setLoading(true);
    try {
      setFetched(
        await api.get<Paginated<TestRunDto>>(
          `/api/projects/${projectId}/test-runs?page=${page}&pageSize=${pageSize}`,
        ),
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }
  const [newRunOpen, setNewRunOpen] = useState(false);

  // While anything is queued or running, refresh the server data so counts
  // and statuses move without a reload.
  // Active runs are the newest, so on page 1; a later page has none to watch.
  const anyActive = runs.items.some((run) => isRunActive(run.status));
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [anyActive, router]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Runs</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={automatedCount === 0}
            title="Every automated case as a Playwright project (.zip), to run outside TestCase MS"
            onClick={() => void downloadProjectScripts(projectId)}
          >
            <Download className="mr-2 size-4" />
            Download all scripts
          </Button>
          {canManage && (
            <Button
              disabled={automatedCount === 0 || environments.length === 0}
              onClick={() => setNewRunOpen(true)}
            >
              <Play className="mr-2 size-4" />
              New run
            </Button>
          )}
        </div>
      </div>

      {canManage && environments.length === 0 && (
        <div className="rounded-md border border-dashed px-3 py-2">
          <NoEnvironmentHint projectId={projectId}> to run scripts against</NoEnvironmentHint>
        </div>
      )}

      {!runnerConfigured && (
        <p className="rounded-md border border-status-blocked/30 bg-status-blocked/10 px-3 py-2 text-sm">
          Automation is not switched on for this server: <code className="font-mono">RUNNER_TOKEN</code>{" "}
          is not set, so runs will wait in the queue. An admin needs to set it and start the runner.
        </p>
      )}

      {runs.total === 0 ? (
        <EmptyState
          icon={Bot}
          title="No runs yet"
          description={
            automatedCount === 0
              ? "Open a Web or API test case and write its Playwright script under Automation. Cases with a script can then be run here."
              : `${automatedCount} case${automatedCount === 1 ? " has" : "s have"} a script. Start a run against one of the project's environments.`
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Run</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead>Results</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Started by</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.items.map((run) => (
                <TableRow
                  key={run.id}
                  className="cursor-pointer"
                  onClick={() =>
                    router.push(
                      `/projects/${projectId}/automation/runs/${run.id}`,
                    )
                  }
                >
                  <TableCell className="font-medium">
                    <Link
                      href={`/projects/${projectId}/automation/runs/${run.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      #{run.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="text-status-passed">
                      {run.passed} passed
                    </span>
                    {run.failed > 0 && (
                      <span className="text-status-failed">
                        {" "}
                        · {run.failed} failed
                      </span>
                    )}
                    {run.errored > 0 && (
                      <span className="text-status-blocked">
                        {" "}
                        · {run.errored} error
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      {" "}
                      / {run.total}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {run.environmentName}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {run.createdBy.name} · {formatRelative(run.createdAt)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {run.startedAt && run.finishedAt
                      ? formatDuration(
                          new Date(run.finishedAt).getTime() -
                            new Date(run.startedAt).getTime(),
                        )
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {runs.total > 0 && (
        <PaginationControls
          page={runs.page}
          pageSize={runs.pageSize}
          total={runs.total}
          totalPages={runs.totalPages}
          disabled={loading}
          onPageChange={(next) => void showPage(next, runs.pageSize)}
          onPageSizeChange={(size) => void showPage(1, size)}
        />
      )}

      <NewRunDialog
        projectId={projectId}
        environments={environments}
        modules={modules}
        subModules={subModules}
        signInCases={signInCases}
        open={newRunOpen}
        onOpenChange={setNewRunOpen}
      />
    </div>
  );
}
