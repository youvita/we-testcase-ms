"use client";

import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { AiJobDto } from "@wetestcase/dto";
import { formatRelative } from "@/utils/format";

const KIND_LABELS: Record<AiJobDto["kind"], string> = {
  EXTRACT_REQUIREMENTS: "Reading document",
  GENERATE_TEST_CASES: "Drafting test cases",
  WRITE_SCRIPT: "Writing a script",
  TRIAGE_FAILURE: "Explaining a failure",
};

/** How many finished jobs to keep on screen under the running ones. */
const RECENT = 3;

/** Running AI work with its progress, and the last few results. */
export function AiJobList({ jobs }: { jobs: AiJobDto[] }) {
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
              {job.status === "FAILED" && job.error && (
                <p className="text-status-failed">{job.error}</p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
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
