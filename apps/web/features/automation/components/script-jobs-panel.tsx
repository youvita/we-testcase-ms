"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleAlert,
  Clock,
  Loader2,
  MessageCircleQuestion,
  Save,
  Sparkles,
  Square,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ScriptJobRow } from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";

const POLL_MS = 3000;
/** Finished work stays on screen this long after the last case ends. */
const SHOW_FINISHED_FOR_MS = 3 * 60 * 60_000;

const active = (row: ScriptJobRow) => row.status === "QUEUED" || row.status === "RUNNING";

/**
 * Claude writing scripts for many cases: where each one stands, which were
 * saved, and which wait for review. Shown above the test case list while a
 * batch runs and for a while after.
 */
export function ScriptJobsPanel({
  projectId,
  initialRows,
}: {
  projectId: string;
  /** From the server render; a refresh after starting a batch brings it in. */
  initialRows: ScriptJobRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [hidden, setHidden] = useState(false);
  // The batch this person closed, remembered in their browser, so a reload
  // does not bring it back. Null until read: until then a finished batch
  // is not drawn, so it never flashes up and away.
  const [closedBatch, setClosedBatch] = useState<string | null | undefined>(undefined);
  const storageKey = `wetestcase:closed-script-batch:${projectId}`;
  useEffect(() => {
    try {
      setClosedBatch(window.localStorage.getItem(storageKey));
    } catch {
      setClosedBatch(null);
    }
  }, [storageKey]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    setRows(initialRows);
    // A new batch arriving should show even if the last one was hidden.
    if (initialRows.some(active)) setHidden(false);
  }, [initialRows]);

  const anyActive = rows.some(active);

  useEffect(() => {
    if (!anyActive) return;
    let stop = false;
    const tick = async () => {
      try {
        const next = await api.get<ScriptJobRow[]>(`/api/projects/${projectId}/scripts/jobs`);
        if (stop) return;
        const wasActive = new Set(rowsRef.current.filter(active).map((r) => r.jobId));
        const justSaved = next.some((r) => wasActive.has(r.jobId) && !active(r) && r.saved);
        setRows(next);
        // A saved script changes the list's "automated" marks.
        if (justSaved) router.refresh();
      } catch {
        // Retried on the next tick.
      }
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [anyActive, projectId, router]);

  // The batch on screen: the newest one, with everything it queued.
  const latestBatch = rows.find((r) => r.batchId)?.batchId ?? null;
  const shown = rows.filter((r) =>
    latestBatch ? r.batchId === latestBatch : false,
  );
  const lastActivity = Math.max(0, ...shown.map((r) => new Date(r.createdAt).getTime()));
  const stale = !shown.some(active) && Date.now() - lastActivity > SHOW_FINISHED_FOR_MS;
  const finished = !shown.some(active);
  const closed = finished && (closedBatch === undefined || closedBatch === latestBatch);
  if (hidden || closed || shown.length === 0 || stale) return null;

  const done = shown.filter((r) => !active(r)).length;
  const saved = shown.filter((r) => r.saved).length;
  const review = shown.filter((r) => r.status === "SUCCEEDED" && !r.saved).length;
  const running = shown.some(active);

  async function stopBatch() {
    try {
      const { stopped } = await api.post<{ stopped: number }>(
        `/api/projects/${projectId}/scripts/jobs/stop`,
        { batchId: latestBatch },
      );
      toast.message(
        stopped ? `Stopped ${stopped} case${stopped === 1 ? "" : "s"} — the one in progress will finish.` : "Nothing left to stop.",
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Sparkles className="size-4 text-primary" />
          <span className="font-medium">
            {running ? "Claude is writing scripts" : "Claude finished writing scripts"}
          </span>
          <span className="text-sm text-muted-foreground">
            {done} of {shown.length} done · {saved} saved · {review} to review
          </span>
          <div className="ml-auto flex gap-2">
            {running && (
              <Button size="sm" variant="outline" onClick={() => void stopBatch()}>
                <Square className="mr-2 size-3.5" />
                Stop the rest
              </Button>
            )}
            {!running && (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Close"
                onClick={() => {
                  setHidden(true);
                  try {
                    if (latestBatch) window.localStorage.setItem(storageKey, latestBatch);
                  } catch {
                    // Without storage it simply comes back on reload.
                  }
                }}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        </div>
        {running && <Progress value={(done / shown.length) * 100} className="h-1.5" />}

        <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
          {[...shown].reverse().map((row) => (
            <li key={row.jobId} className="flex min-w-0 items-center gap-2">
              <RowIcon row={row} />
              {row.testCase ? (
                <Link
                  href={`/projects/${projectId}/test-cases/${row.testCase.id}`}
                  className="flex min-w-0 items-center gap-1.5 hover:underline"
                >
                  <span className="shrink-0 font-mono text-xs">{row.testCase.tcId}</span>
                  <span className="truncate text-muted-foreground">{rowLabel(row)}</span>
                </Link>
              ) : (
                <span className="text-muted-foreground">{rowLabel(row)}</span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function rowLabel(row: ScriptJobRow): string {
  if (row.status === "QUEUED") return "waiting";
  if (row.status === "RUNNING") return "writing…";
  if (row.status === "FAILED") return row.error?.startsWith("Stopped") ? "stopped" : (row.error ?? "failed");
  if (row.saved) return "passes — saved";
  switch (row.outcome) {
    case "passed":
      return "passes — review and save";
    case "product_bug":
      return "looks like a product bug — review";
    case "needs_info":
      return "needs information — review";
    default:
      return "still failing — review";
  }
}

function RowIcon({ row }: { row: ScriptJobRow }) {
  const cls = "size-4 shrink-0";
  if (row.status === "QUEUED") return <Clock className={`${cls} text-muted-foreground`} />;
  if (row.status === "RUNNING") return <Loader2 className={`${cls} animate-spin text-primary`} />;
  if (row.status === "FAILED") return <XCircle className={`${cls} text-muted-foreground`} />;
  if (row.saved) return <Save className={`${cls} text-status-passed`} />;
  if (row.outcome === "passed") return <CheckCircle2 className={`${cls} text-status-passed`} />;
  if (row.outcome === "product_bug") return <XCircle className={`${cls} text-status-failed`} />;
  if (row.outcome === "needs_info") return <MessageCircleQuestion className={`${cls} text-status-blocked`} />;
  return <CircleAlert className={`${cls} text-status-blocked`} />;
}
