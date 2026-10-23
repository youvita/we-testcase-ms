"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Download, Loader2, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PlatformBadge } from "@/components/shared/priority-badge";
import { withBasePath } from "@/lib/base-path";
import type { TestRunDetailDto, TestRunItemDto } from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";
import { formatBytes, formatDateTime } from "@/utils/format";

import { RunStatusBadge, formatDuration, isRunActive } from "./run-status-badge";

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
  const active = isRunActive(run.status);

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
            <RunItemRow key={item.id} projectId={projectId} item={item} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function RunItemRow({ projectId, item }: { projectId: string; item: TestRunItemDto }) {
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
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Script as it ran</summary>
            <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{item.code}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
