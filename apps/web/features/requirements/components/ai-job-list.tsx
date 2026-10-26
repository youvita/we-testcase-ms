"use client";

import { useState } from "react";
import { CheckCircle2, Clock, Loader2, RotateCcw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { AiJobDto, ExploreAppResult } from "@wetestcase/dto";
import { formatRelative } from "@/utils/format";

const KIND_LABELS: Record<AiJobDto["kind"], string> = {
  EXTRACT_REQUIREMENTS: "Reading document",
  GENERATE_TEST_CASES: "Drafting test cases",
  WRITE_SCRIPT: "Writing a script",
  TRIAGE_FAILURE: "Explaining a failure",
  EXPLORE_APP: "Exploring the app",
  GENERATE_FRD: "Writing an FRD",
};

/** How many finished jobs to keep on screen under the running ones. */
const RECENT = 3;

/** The bridge's answer when the subscription token is missing or refused. */
export function isSubscriptionError(error: string | null): boolean {
  return /subscription/i.test(error ?? "");
}

/** Running AI work with its progress, and the last few results. */
export function AiJobList({
  jobs,
  onRetry,
}: {
  jobs: AiJobDto[];
  /** Start a failed job again with the same request; absent for viewers. */
  onRetry?: (job: AiJobDto) => Promise<void>;
}) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const active = jobs.filter(
    (job) => job.status === "QUEUED" || job.status === "RUNNING",
  );
  const recent = jobs
    .filter((job) => job.status === "SUCCEEDED" || job.status === "FAILED")
    .slice(0, RECENT);
  if (active.length === 0 && recent.length === 0) return null;

  return (
    <Card>
      <CardContent className="divide-y p-0">
        {[...active, ...recent].map((job) => (
          <div key={job.id} className="flex items-start gap-3 px-4 py-3 text-sm">
            <JobIcon status={job.status} />
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
                <p className="text-status-failed">{job.error}</p>
              )}
              {job.status === "FAILED" && onRetry && !isSuperseded(job, jobs) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retrying !== null}
                  onClick={async () => {
                    setRetrying(job.id);
                    try {
                      await onRetry(job);
                    } finally {
                      setRetrying(null);
                    }
                  }}
                >
                  {retrying === job.id ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 size-4" />
                  )}
                  {isSubscriptionError(job.error) ? "Reconnect and try again" : "Try again"}
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Started again already: a later job of the same kind on the same document.
 * Jobs arrive newest first.
 */
function isSuperseded(job: AiJobDto, jobs: AiJobDto[]): boolean {
  const index = jobs.indexOf(job);
  return jobs
    .slice(0, index)
    .some((later) => later.kind === job.kind && later.docId === job.docId);
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
