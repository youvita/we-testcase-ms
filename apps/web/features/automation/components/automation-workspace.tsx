"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Download, Play, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  SCROLL_BOX,
  STICKY_HEADER,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
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
  currentUserId,
  isAdmin = false,
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
  /** Who may delete a run: whoever started it, or an admin. */
  currentUserId: string;
  isAdmin?: boolean;
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
    setSelected(new Set());
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

  // Runs picked to delete, on the page shown.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [withResults, setWithResults] = useState(false);
  const deletable = (run: TestRunDto) =>
    canManage && !isRunActive(run.status) && (isAdmin || run.createdBy.id === currentUserId);
  const pageDeletable = runs.items.filter(deletable);
  const picked = runs.items.filter((run) => selected.has(run.id));
  const allPicked = pageDeletable.length > 0 && pageDeletable.every((run) => selected.has(run.id));
  const pickedNumbers = picked.map((run) => `#${run.code ?? run.number}`).join(", ");
  const recorded = picked.filter((run) => run.recordResults).length;

  function toggle(runId: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(runId);
      else next.delete(runId);
      return next;
    });
  }

  async function deleteRuns() {
    try {
      const result = await api.post<{ deleted: number; resultsDeleted: number; resultsKept: number }>(
        `/api/projects/${projectId}/test-runs/delete`,
        { runIds: picked.map((run) => run.id), withResults },
      );
      toast.success(
        `Deleted ${result.deleted} run${result.deleted === 1 ? "" : "s"}` +
          (withResults ? ` and ${result.resultsDeleted} result${result.resultsDeleted === 1 ? "" : "s"}` : ""),
        result.resultsKept
          ? { description: `${result.resultsKept} result${result.resultsKept === 1 ? " was" : "s were"} kept — a developer is working from ${result.resultsKept === 1 ? "it" : "them"}.` }
          : undefined,
      );
      setSelected(new Set());
      setDeleteOpen(false);
      setWithResults(false);
      setFetched(null);
      if (!onFirstPage) await showPage(view.page, view.pageSize);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

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
            data-tour="auto-download"
            title="Every automated case as a Playwright project (.zip), to run outside WeTestCase"
            onClick={() => void downloadProjectScripts(projectId)}
          >
            <Download className="mr-2 size-4" />
            Download all scripts
          </Button>
          {canManage && (
            <Button
              disabled={automatedCount === 0 || environments.length === 0}
              data-tour="auto-new-run"
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
        <div data-tour="auto-runs">
        <EmptyState
          icon={Bot}
          title="No runs yet"
          description={
            automatedCount === 0
              ? "Open a Web or API test case and write its Playwright script under Automation. Cases with a script can then be run here."
              : `${automatedCount} case${automatedCount === 1 ? " has" : "s have"} a script. Start a run against one of the project's environments.`
          }
        />
        </div>
      ) : (
        <>
        {picked.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">
              {picked.length} run{picked.length === 1 ? "" : "s"} selected
            </span>
            <span className="text-muted-foreground">{pickedNumbers}</span>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                <X className="mr-1.5 size-4" />
                Clear
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-1.5 size-4" />
                Delete
              </Button>
            </div>
          </div>
        )}
        <Card data-tour="auto-runs" className="overflow-hidden">
          {/* The runs scroll inside the card, under a header that stays put,
              so the page — buttons, pages — stays where it is. */}
          <Table containerClassName={SCROLL_BOX}>
            <TableHeader className={cn(STICKY_HEADER, "bg-card")}>
              <TableRow>
                {canManage && (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select every run you can delete on this page"
                      disabled={pageDeletable.length === 0}
                      checked={allPicked}
                      onCheckedChange={(on) =>
                        setSelected(on === true ? new Set(pageDeletable.map((run) => run.id)) : new Set())
                      }
                    />
                  </TableHead>
                )}
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
                  {canManage && (
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        aria-label={`Select run #${run.code ?? run.number}`}
                        disabled={!deletable(run)}
                        title={
                          deletable(run)
                            ? undefined
                            : isRunActive(run.status)
                              ? "Still going — cancel it first"
                              : "Only whoever started it, or an admin, can delete it"
                        }
                        checked={selected.has(run.id)}
                        onCheckedChange={(on) => toggle(run.id, on === true)}
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-medium">
                    <Link
                      href={`/projects/${projectId}/automation/runs/${run.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="font-mono">#{run.code ?? run.number}</span>
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
        </>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setWithResults(false);
        }}
        title={`Delete ${picked.length === 1 ? `run ${pickedNumbers}` : `${picked.length} runs`}?`}
        description={
          <span className="block space-y-3">
            <span className="block">
              {picked.length === 1 ? "The run" : `Runs ${pickedNumbers}`}, with {picked.length === 1 ? "its" : "their"}{" "}
              logs, screenshots, videos and traces, {picked.length === 1 ? "is" : "are"} removed for good. Run numbers
              are not reused.
            </span>
            {recorded > 0 && (
              <label className="flex items-start gap-2.5 rounded-md border p-3 text-sm text-foreground">
                <Checkbox
                  className="mt-0.5"
                  checked={withResults}
                  onCheckedChange={(on) => setWithResults(on === true)}
                />
                <span>
                  Also delete the results {picked.length === 1 ? "it" : "they"} recorded on test cases
                  <span className="block text-xs text-muted-foreground">
                    Otherwise they stay in each case&apos;s execution history, with their screenshots. A result a
                    developer is working from is kept either way.
                  </span>
                </span>
              </label>
            )}
          </span>
        }
        confirmLabel="Delete"
        destructive
        onConfirm={deleteRuns}
      />

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
