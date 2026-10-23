"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  MessageCircleQuestion,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  AiJobDto,
  Platform,
  RunEnvironmentDto,
  ScriptWritingResult,
} from "@wetestcase/dto";
import { ApiError, api, errorMessage } from "@/utils/api-client";

import { LiveView, WatchLiveFields, type LiveChoice } from "./live-view";
import { RunStatusBadge } from "./run-status-badge";

/**
 * Ask Claude to write the script. It tries each draft against the chosen
 * environment, so the environment matters as much as the steps.
 */
export function WriteWithClaudeDialog({
  testCaseId,
  platform,
  environments,
  open,
  onOpenChange,
  onStarted,
  onNeedsSubscription,
}: {
  testCaseId: string;
  platform: Platform;
  environments: RunEnvironmentDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (job: AiJobDto) => void;
  /** Called with a retry when the person has no Claude subscription connected. */
  onNeedsSubscription: (retry: () => void) => void;
}) {
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? "");
  // Blank: the environment's own start page.
  const [startPath, setStartPath] = useState("");
  const [instructions, setInstructions] = useState("");
  const [live, setLive] = useState<LiveChoice>({ liveView: false, speed: "slow" });
  const [busy, setBusy] = useState(false);
  const selected = environments.some((e) => e.id === environmentId)
    ? environmentId
    : (environments[0]?.id ?? "");
  const selectedEnvironment = environments.find((e) => e.id === selected);
  const envName = selectedEnvironment?.name ?? "the environment";
  const envStart = selectedEnvironment?.startPath ?? "/";

  async function start() {
    setBusy(true);
    try {
      const job = await api.post<AiJobDto>(`/api/test-cases/${testCaseId}/script/write`, {
        environmentId: selected,
        startPath: startPath.trim() || undefined,
        instructions,
        liveView: live.liveView,
        speed: live.liveView ? live.speed : "normal",
      });
      onOpenChange(false);
      onStarted(job);
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        onOpenChange(false);
        onNeedsSubscription(() => void start());
      } else {
        toast.error(errorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Write the script with Claude</DialogTitle>
          <DialogDescription>
            Claude reads this test case, looks at the real{" "}
            {platform === "API" ? "API" : "page"}, writes the script and tries it — up
            to three times — fixing what fails. Tries are script checks: nothing
            is recorded on the case, and nothing is saved until you choose to.
          </DialogDescription>
        </DialogHeader>

        {environments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add an environment first, under Automation → Environments, with the
            base URL and the test account variables.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Try it against</Label>
              <Select value={selected} onValueChange={setEnvironmentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {environments.map((env) => (
                    <SelectItem key={env.id} value={env.id}>
                      {env.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {platform === "WEB" && (
              <div className="space-y-2">
                <Label htmlFor="start-path">Start page (optional)</Label>
                <Input
                  id="start-path"
                  value={startPath}
                  onChange={(e) => setStartPath(e.target.value)}
                  placeholder={envStart}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to use {envName}&apos;s start page ({envStart}). Set it only if this
                  case begins somewhere else.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="write-instructions">Anything the steps leave out (optional)</Label>
              <Textarea
                id="write-instructions"
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Use vars.LOGIN_ID and vars.LOGIN_PASSWORD. After login the home page shows “My Bills”."
              />
            </div>
            {platform === "WEB" && <WatchLiveFields value={live} onChange={setLive} />}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !selected} onClick={() => void start()}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const OUTCOMES: Record<
  ScriptWritingResult["outcome"],
  { label: string; icon: typeof CheckCircle2; tone: string }
> = {
  passed: {
    label: "The script passes",
    icon: CheckCircle2,
    tone: "border-status-passed/30 bg-status-passed/10 text-status-passed",
  },
  product_bug: {
    label: "The script works — the product does not meet the expected result",
    icon: XCircle,
    tone: "border-status-failed/30 bg-status-failed/10 text-status-failed",
  },
  needs_info: {
    label: "Claude needs something from you to finish",
    icon: MessageCircleQuestion,
    tone: "border-status-blocked/30 bg-status-blocked/10 text-status-blocked",
  },
  failing: {
    label: "Still failing after three tries",
    icon: CircleAlert,
    tone: "border-status-blocked/30 bg-status-blocked/10 text-status-blocked",
  },
};

/**
 * Where Claude is in writing the script, and what it produced. "Use this
 * script" puts it in the editor; saving stays with QA.
 */
export function ScriptWritingPanel({
  projectId,
  job,
  savedCode,
  onUse,
}: {
  projectId: string;
  job: AiJobDto;
  /** The script saved on the case, to tell when Claude's is already in use. */
  savedCode: string | null;
  onUse: (code: string) => void;
}) {
  const result = job.result as ScriptWritingResult | null;
  const active = job.status === "QUEUED" || job.status === "RUNNING";
  const outcome = result && !active && job.status === "SUCCEEDED" ? OUTCOMES[result.outcome] : null;

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Sparkles className="size-4 text-primary" />
        Claude
        {active && (
          <span className="flex items-center gap-1.5 font-normal text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {job.status === "QUEUED"
              ? "waiting for your earlier AI job…"
              : job.progressDone === 0
                ? "opening the page…"
                : `trying draft ${Math.max(1, result?.attempts.length ?? 0)}…`}
          </span>
        )}
      </div>

      {active && job.progressTotal > 0 && (
        <Progress value={(job.progressDone / job.progressTotal) * 100} className="h-1.5" />
      )}

      {active && result?.currentRunId && (
        <LiveView runId={result.currentRunId} quietWhenEmpty />
      )}

      {result && result.attempts.length > 0 && (
        <ol className="space-y-1">
          {result.attempts.map((attempt, index) => (
            <li key={attempt.runId} className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Try {index + 1}</span>
              <RunStatusBadge status={attempt.status} />
              <Link
                href={`/projects/${projectId}/automation/runs/${attempt.runId}`}
                className="truncate text-muted-foreground hover:underline"
                title={attempt.error ?? undefined}
              >
                {attempt.error ? attempt.error.split("\n")[0] : "see screenshot and trace"}
              </Link>
            </li>
          ))}
        </ol>
      )}

      {job.status === "FAILED" && <p className="text-status-failed">{job.error}</p>}

      {outcome && result && (
        <>
          <p className={cn("flex items-start gap-2 rounded-md border px-3 py-2", outcome.tone)}>
            <outcome.icon className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-medium">{outcome.label}</span>
              {result.notes && <span className="block text-foreground/80">{result.notes}</span>}
            </span>
          </p>
          <pre className="max-h-72 overflow-auto rounded-md bg-background p-3 font-mono text-xs">{result.code}</pre>
          {savedCode?.trim() === result.code.trim() ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-status-passed" />
              This is the saved script.
            </p>
          ) : (
            <Button size="sm" onClick={() => onUse(result.code)}>
              Use this script
            </Button>
          )}
        </>
      )}
    </div>
  );
}
