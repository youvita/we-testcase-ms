"use client";

import { useEffect, useState } from "react";
import { Ban, CheckCircle2, Clock, History, Loader2, RotateCcw, Square, X, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { AiJobDto, ExploreAppResult } from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";
import { formatRelative } from "@/utils/format";

const KIND_LABELS: Record<AiJobDto["kind"], string> = {
  EXTRACT_REQUIREMENTS: "Reading document",
  GENERATE_TEST_CASES: "Drafting test cases",
  WRITE_SCRIPT: "Writing a script",
  TRIAGE_FAILURE: "Explaining a failure",
  EXPLORE_APP: "Exploring the app",
  GENERATE_FRD: "Writing an FRD",
};

/** The kinds of job the Requirements page shows, as a query string. */
export const REQUIREMENT_JOBS_QUERY =
  "kind=EXTRACT_REQUIREMENTS&kind=GENERATE_TEST_CASES&kind=EXPLORE_APP";

/** How many finished jobs to keep on screen under the running ones. */
const RECENT = 3;
/** How far back "Show history" goes. */
const HISTORY_LIMIT = 50;

/** The bridge's answer when the subscription token is missing or refused. */
export function isSubscriptionError(error: string | null): boolean {
  return /subscription/i.test(error ?? "");
}

/**
 * Running AI work with its progress, and the last few results.
 *
 * A failure that a later run has since done successfully is left out, and
 * finished rows can be dismissed — per person, in this browser. The
 * history lists everything, dismissed and fixed included.
 */
export function AiJobList({
  projectId,
  jobs,
  onRetry,
  onCancel,
}: {
  projectId: string;
  jobs: AiJobDto[];
  /** Start a failed job again with the same request; absent for viewers. */
  onRetry?: (job: AiJobDto) => Promise<void>;
  /** Stop a queued or running job; absent for viewers. */
  onCancel?: (job: AiJobDto) => Promise<void>;
}) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [dismissed, setDismissed] = useDismissed(projectId);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AiJobDto[] | null>(null);

  useEffect(() => {
    if (!showHistory) return;
    let cancelled = false;
    api
      .get<AiJobDto[]>(`/api/projects/${projectId}/ai-jobs?${REQUIREMENT_JOBS_QUERY}&limit=${HISTORY_LIMIT}`)
      .then((loaded) => {
        if (!cancelled) setHistory(loaded);
      })
      .catch((error) => toast.error(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [showHistory, projectId]);

  // The live list wins for any job in both: it is the one being polled.
  const all = mergeNewestFirst(jobs, showHistory ? (history ?? []) : []);
  const active = all.filter(isActive);
  const finished = all.filter((job) => !isActive(job));
  const shown = showHistory
    ? finished
    : finished
        .slice(0, RECENT)
        .filter((job) => !dismissed.has(job.id) && !(job.status === "FAILED" && isFixed(job, all)));

  if (active.length === 0 && finished.length === 0) return null;

  async function retry(job: AiJobDto) {
    if (!onRetry) return;
    setRetrying(job.id);
    try {
      await onRetry(job);
    } finally {
      setRetrying(null);
    }
  }

  async function cancel(job: AiJobDto) {
    if (!onCancel) return;
    setCancelling(job.id);
    try {
      await onCancel(job);
    } finally {
      setCancelling(null);
    }
  }

  const rows = [...active, ...shown];
  const historyLink = (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 text-muted-foreground"
      onClick={() => setShowHistory(true)}
    >
      <History className="mr-1.5 size-3.5" />
      {rows.length === 0 ? "AI job history" : "View history"}
    </Button>
  );

  // Everything recent dismissed or fixed: no empty card, just the way back in.
  if (!showHistory && rows.length === 0) {
    return <div className="flex justify-end">{historyLink}</div>;
  }

  return (
    <Card>
      <CardContent className="divide-y p-0">
        {showHistory && (
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-sm font-medium">AI job history</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-muted-foreground"
              onClick={() => setShowHistory(false)}
            >
              Hide
            </Button>
          </div>
        )}
        {rows.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            fixed={job.status === "FAILED" && isFixed(job, all)}
            canRetry={job.status === "FAILED" && !!onRetry && !isSuperseded(job, all)}
            retrying={retrying}
            onRetry={() => void retry(job)}
            cancelling={cancelling === job.id}
            onCancel={onCancel && isActive(job) ? () => void cancel(job) : undefined}
            onDismiss={
              showHistory || isActive(job)
                ? undefined
                : () => setDismissed(new Set(dismissed).add(job.id))
            }
          />
        ))}
        {showHistory && history === null && (
          <div className="flex justify-center py-3">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {showHistory && history !== null && history.length >= HISTORY_LIMIT && (
          <p className="px-4 py-2 text-center text-xs text-muted-foreground">
            Showing the latest {HISTORY_LIMIT}.
          </p>
        )}
        {!showHistory && finished.length > 0 && (
          <div className="flex justify-end px-2 py-1">{historyLink}</div>
        )}
      </CardContent>
    </Card>
  );
}

function JobRow({
  job,
  fixed,
  canRetry,
  retrying,
  onRetry,
  cancelling,
  onCancel,
  onDismiss,
}: {
  job: AiJobDto;
  /** Failed, but a later run did the same work successfully. */
  fixed: boolean;
  canRetry: boolean;
  retrying: string | null;
  onRetry: () => void;
  cancelling: boolean;
  /** Stop it; only while it is queued or running. */
  onCancel?: () => void;
  onDismiss?: () => void;
}) {
  const stopped = isCancelled(job);
  return (
    <div className="flex items-start gap-3 px-4 py-3 text-sm">
      {stopped ? <Ban className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <JobIcon status={job.status} />}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-medium">{KIND_LABELS[job.kind]}</span>
          <span className="text-xs text-muted-foreground">
            {job.createdBy.name} · {formatRelative(job.finishedAt ?? job.createdAt)}
          </span>
        </div>
        {job.status === "RUNNING" && job.progressTotal > 0 && (
          <div className="flex items-center gap-2">
            <Progress
              value={(job.progressDone / job.progressTotal) * 100}
              className="h-1.5"
            />
            <span className="shrink-0 text-xs text-muted-foreground">
              {job.progressDone} / {job.progressTotal}
            </span>
          </div>
        )}
        {job.status === "QUEUED" && (
          <p className="text-muted-foreground">
            Waiting for this person&apos;s earlier AI job to finish…
          </p>
        )}
        {job.status === "SUCCEEDED" && job.summary && (
          <p className="text-muted-foreground">{job.summary}</p>
        )}
        {job.status === "SUCCEEDED" && job.kind === "EXPLORE_APP" && (
          <Observations result={job.result as ExploreAppResult | null} />
        )}
        {job.status === "FAILED" && job.error && (
          <p className={fixed || stopped ? "text-muted-foreground" : "text-status-failed"}>{job.error}</p>
        )}
        {fixed && <p className="text-xs text-status-passed">Fixed — a later run succeeded.</p>}
        {canRetry && !fixed && (
          <Button size="sm" variant="outline" disabled={retrying !== null} onClick={onRetry}>
            {retrying === job.id ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 size-4" />
            )}
            {isSubscriptionError(job.error) ? "Reconnect and try again" : stopped ? "Start again" : "Try again"}
          </Button>
        )}
      </div>
      {onCancel && (
        <Button
          size="sm"
          variant="outline"
          className="-my-1 h-7 shrink-0"
          disabled={cancelling}
          title="Stop this AI job. Anything it already saved stays."
          onClick={onCancel}
        >
          {cancelling ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Square className="mr-1.5 size-3.5" />}
          Cancel
        </Button>
      )}
      {onDismiss && (
        <Button
          size="icon"
          variant="ghost"
          className="-my-1 size-7 shrink-0 text-muted-foreground"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={onDismiss}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}

function isActive(job: AiJobDto): boolean {
  return job.status === "QUEUED" || job.status === "RUNNING";
}

/** Stopped by a person (or before it started), not failed. See cancelJob and stopQueuedJobs. */
function isCancelled(job: AiJobDto): boolean {
  return job.status === "FAILED" && /^(Cancelled by |Stopped before it started)/.test(job.error ?? "");
}

/** Both lists, one row per job, newest first. */
function mergeNewestFirst(primary: AiJobDto[], extra: AiJobDto[]): AiJobDto[] {
  const byId = new Map(extra.map((job) => [job.id, job]));
  for (const job of primary) byId.set(job.id, job);
  return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** `later` set out to do at least everything `job` did. */
function covers(later: AiJobDto, job: AiJobDto): boolean {
  if (later.kind !== job.kind || later.createdAt <= job.createdAt) return false;
  // Kinds without targets fall back to the document, as before targets existed.
  if (job.targets.length === 0) return later.docId === job.docId;
  return job.targets.every((target) => later.targets.includes(target));
}

/** Started again already, whatever came of it. */
function isSuperseded(job: AiJobDto, jobs: AiJobDto[]): boolean {
  return jobs.some((later) => covers(later, job));
}

/** A later run did the same work and succeeded. */
function isFixed(job: AiJobDto, jobs: AiJobDto[]): boolean {
  return jobs.some((later) => later.status === "SUCCEEDED" && covers(later, job));
}

/**
 * Jobs this person has dismissed on this project. Kept in the browser: it is
 * one person's tidying, not something to hide from the rest of the team.
 */
function useDismissed(projectId: string) {
  const key = `ai-jobs-dismissed:${projectId}`;
  const [dismissed, setState] = useState<Set<string>>(new Set());

  // Read after mount, so the server render and the first client render agree.
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
      setState(new Set(Array.isArray(stored) ? stored.map(String) : []));
    } catch {
      setState(new Set());
    }
  }, [key]);

  function setDismissed(next: Set<string>) {
    setState(next);
    try {
      // Only the newest ids matter; older jobs have left the list anyway.
      localStorage.setItem(key, JSON.stringify(Array.from(next).slice(-200)));
    } catch {
      /* private window or blocked storage: dismissed for this visit only */
    }
  }

  return [dismissed, setDismissed] as const;
}

function JobIcon({ status }: { status: AiJobDto["status"] }) {
  const className = "mt-0.5 size-4 shrink-0";
  switch (status) {
    case "RUNNING":
      return <Loader2 className={`${className} animate-spin text-primary`} />;
    case "QUEUED":
      return <Clock className={`${className} text-muted-foreground`} />;
    case "SUCCEEDED":
      return <CheckCircle2 className={`${className} text-status-passed`} />;
    case "FAILED":
      return <XCircle className={`${className} text-status-failed`} />;
  }
}

/** What Claude noticed while exploring that is not a test case. */
function Observations({ result }: { result: ExploreAppResult | null }) {
  if (!result?.observations.length) return null;
  return (
    <div className="text-xs">
      <p className="font-medium text-foreground">The AI also noticed</p>
      <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
        {result.observations.map((note, index) => (
          <li key={index}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
