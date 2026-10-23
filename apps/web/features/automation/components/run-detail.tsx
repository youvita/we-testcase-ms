"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Download, Loader2, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PlatformBadge } from "@/components/shared/priority-badge";
import { withBasePath } from "@/lib/base-path";
import { ClaudeConnectionDialog } from "@/features/ai/components/claude-connection-dialog";
import type { AiJobDto, TestRunDetailDto, TestRunItemDto } from "@wetestcase/dto";
import { ApiError, api, errorMessage } from "@/utils/api-client";
import { formatBytes, formatDateTime } from "@/utils/format";

import { RunStatusBadge, formatDuration, isRunActive } from "./run-status-badge";
import { LiveView } from "./live-view";
import { TriageCard } from "./triage-card";

const POLL_MS = 2500;

export function RunDetail({
  projectId,
  run: initial,
  canManage,
}: {
  projectId: string;
  run: TestRunDetailDto;
  canManage: boolean;
}) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [cancelling, setCancelling] = useState(false);
  /** Triage jobs in flight, by run item. */
  const [triaging, setTriaging] = useState<Record<string, string>>({});
  const [connectOpen, setConnectOpen] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);
  const active = isRunActive(run.status);

  const refetch = useCallback(async () => {
    setRun(await api.get<TestRunDetailDto>(`/api/test-runs/${run.id}`));
  }, [run.id]);

  // Follow the triage jobs; when one ends, reload the run for its verdict.
  const pendingJobs = Object.values(triaging).join(",");
  useEffect(() => {
    if (!pendingJobs) return;
    const timer = setInterval(async () => {
      const finished: string[] = [];
      for (const [itemId, jobId] of Object.entries(triaging)) {
        try {
          const job = await api.get<AiJobDto>(`/api/ai-jobs/${jobId}`);
          if (job.status === "SUCCEEDED" || job.status === "FAILED") {
            finished.push(itemId);
            if (job.status === "FAILED") toast.error(job.error ?? "Claude could not explain this failure");
          }
        } catch {
          // Retried on the next tick.
        }
      }
      if (finished.length) {
        setTriaging((current) => {
          const next = { ...current };
          for (const id of finished) delete next[id];
          return next;
        });
        await refetch().catch(() => undefined);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pendingJobs, triaging, refetch]);

  async function explain(itemIds: string[] | "all") {
    try {
      const jobs =
        itemIds === "all"
          ? await api.post<AiJobDto[]>(`/api/test-runs/${run.id}/triage`)
          : [await api.post<AiJobDto>(`/api/run-items/${itemIds[0]}/triage`)];
      const ids = itemIds === "all" ? unexplained.map((item) => item.id) : itemIds;
      setTriaging((current) => {
        const next = { ...current };
        jobs.forEach((job, index) => {
          const itemId = ids[index];
          if (itemId) next[itemId] = job.id;
        });
        return next;
      });
      toast.message(jobs.length === 1 ? "Claude is looking at it…" : `Claude is looking at ${jobs.length} failures…`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        retryRef.current = () => void explain(itemIds);
        setConnectOpen(true);
      } else {
        toast.error(errorMessage(error));
      }
    }
  }

  useEffect(() => setRun(initial), [initial]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      try {
        const next = await api.get<TestRunDetailDto>(`/api/test-runs/${run.id}`);
        setRun(next);
        // Finished: refresh the server render too, so links and stats settle.
        if (!isRunActive(next.status)) router.refresh();
      } catch {
        // Retried on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [active, run.id, router]);

  async function handleCancel() {
    setCancelling(true);
    try {
      await api.post(`/api/test-runs/${run.id}/cancel`);
      toast.message("Stopping the run…");
      setRun(await api.get<TestRunDetailDto>(`/api/test-runs/${run.id}`));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCancelling(false);
    }
  }

  const done = run.items.filter((item) => item.status !== "QUEUED").length;
  const unexplained = run.items.filter(
    (item) => (item.status === "FAILED" || item.status === "ERROR") && !item.triage && !triaging[item.id],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <RunStatusBadge status={run.status} />
              <span>
                <span className="text-status-passed">{run.passed} passed</span>
                {run.failed > 0 && <span className="text-status-failed"> · {run.failed} failed</span>}
                {run.errored > 0 && <span className="text-status-blocked"> · {run.errored} script error</span>}
                {run.skipped > 0 && <span className="text-muted-foreground"> · {run.skipped} skipped</span>}
              </span>
              <span className="text-muted-foreground">
                {run.environmentName} · by {run.createdBy.name} · {formatDateTime(run.createdAt)}
                {!run.recordResults && " · results not recorded"}
              </span>
            </div>
            {canManage && !active && unexplained.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => void explain("all")}>
                <Sparkles className="mr-2 size-4" />
                Explain {unexplained.length} failure{unexplained.length === 1 ? "" : "s"} with Claude
              </Button>
            )}
            {canManage && active && (
              <Button
                size="sm"
                variant="outline"
                disabled={cancelling || run.cancelRequested}
                onClick={() => void handleCancel()}
              >
                {cancelling ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Square className="mr-2 size-4" />}
                {run.cancelRequested ? "Stopping…" : "Cancel run"}
              </Button>
            )}
          </div>

          {active && (
            <div className="flex items-center gap-3">
              <Progress value={(done / Math.max(1, run.total)) * 100} className="h-1.5" />
              <span className="shrink-0 text-xs text-muted-foreground">
                {run.status === "QUEUED" ? "Waiting for the runner…" : `${done} / ${run.total}`}
              </span>
            </div>
          )}

          {run.liveView && run.status === "RUNNING" && (
            <LiveView
              runId={run.id}
              labels={Object.fromEntries(
                run.items.map((item) => [item.id, `${item.testCase.tcId} ${item.testCase.title}`]),
              )}
            />
          )}

          {run.error && (
            <p className="whitespace-pre-wrap rounded-md bg-status-blocked/10 px-3 py-2 text-sm text-status-blocked">
              {run.error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y p-0">
          {run.items.map((item) => (
            <RunItemRow
              key={item.id}
              projectId={projectId}
              item={item}
              canManage={canManage}
              triaging={Boolean(triaging[item.id])}
              onExplain={() => void explain([item.id])}
            />
          ))}
        </CardContent>
      </Card>

      <ClaudeConnectionDialog
        open={connectOpen}
        onOpenChange={(open) => {
          setConnectOpen(open);
          if (!open) retryRef.current = null;
        }}
        onConnected={() => {
          const retry = retryRef.current;
          retryRef.current = null;
          retry?.();
        }}
      />
    </div>
  );
}

function RunItemRow({
  projectId,
  item,
  canManage,
  triaging,
  onExplain,
}: {
  projectId: string;
  item: TestRunItemDto;
  canManage: boolean;
  triaging: boolean;
  onExplain: () => void;
}) {
  // Failures open by default — they are what someone came to look at.
  const [open, setOpen] = useState(item.status === "FAILED" || item.status === "ERROR");
  const artifactUrl = (index: number) => withBasePath(`/api/run-items/${item.id}/artifacts/${index}`);
  const screenshots = item.artifacts.filter((a) => a.kind === "screenshot");
  const video = item.artifacts.find((a) => a.kind === "video");
  const trace = item.artifacts.find((a) => a.kind === "trace");
  const hasDetail = Boolean(item.error || item.log || item.artifacts.length || item.code);

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          disabled={!hasDetail}
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="shrink-0 font-mono text-xs">{item.testCase.tcId}</span>
          <span className="truncate text-sm">{item.testCase.title}</span>
        </button>
        <PlatformBadge platform={item.testCase.platform} />
        <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
          {formatDuration(item.durationMs)}
        </span>
        <RunStatusBadge status={item.status} className="w-24 justify-center" />
      </div>

      {open && (
        <div className="mt-3 space-y-3 pl-6 text-sm">
          {item.error && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
              {item.error}
            </pre>
          )}
          {item.status === "ERROR" && (
            <p className="text-xs text-muted-foreground">
              The script itself failed to run, so no result was recorded on the test case. Fix the script and run it again.
            </p>
          )}

          {item.triage ? (
            <TriageCard triage={item.triage} testCaseId={item.testCase.id} canManage={canManage} />
          ) : (
            canManage &&
            (item.status === "FAILED" || item.status === "ERROR") && (
              <Button size="sm" variant="outline" disabled={triaging} onClick={onExplain}>
                {triaging ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
                {triaging ? "Claude is looking…" : "Ask Claude why"}
              </Button>
            )
          )}

          {screenshots.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {screenshots.map((shot) => (
                <a key={shot.index} href={artifactUrl(shot.index)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API file, not a static asset */}
                  <img
                    src={artifactUrl(shot.index)}
                    alt={`Screenshot of ${item.testCase.tcId}`}
                    className="h-40 rounded-md border object-cover object-top"
                  />
                </a>
              ))}
            </div>
          )}

          {video && (
            <video
              src={artifactUrl(video.index)}
              controls
              preload="metadata"
              className="max-h-80 rounded-md border"
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            {trace && (
              <Button size="sm" variant="outline" asChild>
                <a href={artifactUrl(trace.index)} download>
                  <Download className="mr-2 size-4" />
                  Trace ({formatBytes(trace.size)})
                </a>
              </Button>
            )}
            {trace && (
              <span className="text-xs text-muted-foreground">
                Open it at{" "}
                <a className="underline" href="https://trace.playwright.dev" target="_blank" rel="noreferrer">
                  trace.playwright.dev
                </a>{" "}
                to step through every action, network call and DOM snapshot.
              </span>
            )}
            <Link
              href={`/projects/${projectId}/test-cases/${item.testCase.id}`}
              className="text-xs text-primary hover:underline"
            >
              Open test case
            </Link>
          </div>

          {item.log && (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">Console output</summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
                {item.log}
              </pre>
            </details>
          )}
          {item.artifacts.some((a) => a.kind === "snapshot") && (
            <SnapshotDetails url={artifactUrl(item.artifacts.find((a) => a.kind === "snapshot")!.index)} />
          )}
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Script as it ran</summary>
            <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{item.code}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

/** The page outline at the end of the test, fetched only when opened. */
function SnapshotDetails({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <details
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open && text === null) {
          fetch(url)
            .then((response) => response.text())
            .then(setText)
            .catch(() => setText("Could not load the page outline."));
        }
      }}
    >
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Page outline at the end (what Claude reads)
      </summary>
      <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
        {text ?? "Loading…"}
      </pre>
    </details>
  );
}
