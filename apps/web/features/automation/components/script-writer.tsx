"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileText,
  Loader2,
  MessageCircleQuestion,
  Sparkles,
  Upload,
  X,
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
import { AI_MODELS, AI_MODEL_LABELS, type AiModel } from "@wetestcase/dto";
import { ApiError, api, errorMessage } from "@/utils/api-client";

import { LiveView, WatchLiveFields, type LiveChoice } from "./live-view";
import { RunStatusBadge, formatDuration } from "./run-status-badge";
import { diffLines } from "@/utils/line-diff";
import { CodeView } from "@/components/shared/code-view";
import { errorHeadline, findErrorLine } from "@/utils/error-line";

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
  const [model, setModel] = useState<AiModel>("sonnet");
  // An FRD read for this job only; its text goes with the request.
  const [frd, setFrd] = useState<{ fileName: string; text: string } | null>(null);
  const [readingFrd, setReadingFrd] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = environments.some((e) => e.id === environmentId)
    ? environmentId
    : (environments[0]?.id ?? "");
  const selectedEnvironment = environments.find((e) => e.id === selected);
  const envName = selectedEnvironment?.name ?? "the environment";
  const envStart = selectedEnvironment?.startPath ?? "/";

  async function readFrd(file: File | undefined) {
    if (!file) return;
    setReadingFrd(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const read = await api.post<{ fileName: string; text: string }>("/api/documents/extract", form);
      setFrd({ fileName: read.fileName, text: read.text });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setReadingFrd(false);
    }
  }

  async function start() {
    setBusy(true);
    try {
      const job = await api.post<AiJobDto>(`/api/test-cases/${testCaseId}/script/write`, {
        environmentId: selected,
        startPath: startPath.trim() || undefined,
        instructions,
        model,
        frdText: frd?.text,
        frdName: frd?.fileName,
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
          <DialogTitle>Write the script with AI</DialogTitle>
          <DialogDescription>
            The AI reads this test case, looks at the real{" "}
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
            <div className="space-y-2">
              <Label htmlFor="write-frd">FRD (optional)</Label>
              {frd ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{frd.fileName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {frd.text.length.toLocaleString()} characters
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setFrd(null)}>
                    Remove
                  </Button>
                </div>
              ) : (
                <label
                  htmlFor="write-frd"
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40"
                >
                  {readingFrd ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  {readingFrd ? "Reading the document…" : "Upload a PDF, Word, Markdown or text file"}
                  <input
                    id="write-frd"
                    type="file"
                    className="sr-only"
                    // The formats Requirements → Documents reads.
                    accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm"
                    disabled={readingFrd}
                    onChange={(e) => {
                      void readFrd(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                Gives the AI the rules, field names and messages the steps leave out. Used for this
                script only — not saved to the project.
              </p>
            </div>
            <div className="space-y-2">
              <Label>AI model</Label>
              <Select value={model} onValueChange={(value) => setModel(value as AiModel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_MODELS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {AI_MODEL_LABELS[option].label} — {AI_MODEL_LABELS[option].hint}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {platform === "WEB" && <WatchLiveFields value={live} onChange={setLive} />}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || readingFrd || !selected} onClick={() => void start()}>
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
    label: "The AI needs something from you to finish",
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
  onContinue,
  onCancel,
}: {
  projectId: string;
  job: AiJobDto;
  /** The script saved on the case, to tell when Claude's is already in use. */
  savedCode: string | null;
  onUse: (code: string) => void;
  /** Keep trying from this result with QA's hint; resolves true once started. */
  onContinue?: (hint: string) => Promise<boolean>;
  /** Stop the job while it is queued or running; absent for viewers. */
  onCancel?: () => Promise<void>;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [hint, setHint] = useState("");
  const [continuing, setContinuing] = useState(false);
  // The last try's failure, located in the final script — by content, so it
  // still lands right when the final script is that try's.
  const lastFailure = (job.result as ScriptWritingResult | null)?.attempts
    .filter((a) => a.status !== "PASSED")
    .at(-1);
  const lastAttempt = (job.result as ScriptWritingResult | null)?.attempts.at(-1);
  const finalCode = (job.result as ScriptWritingResult | null)?.code ?? "";
  // Mark a line only when it is the line that failed: the final script is
  // the one that ran, or still contains the failing line word for word.
  const failingLine =
    lastFailure && lastAttempt === lastFailure
      ? lastFailure.code === finalCode
        ? findErrorLine(finalCode, lastFailure.error)
        : findErrorLine(finalCode, lastFailure.error, { textOnly: true })
      : null;
  const result = job.result as ScriptWritingResult | null;
  const active = job.status === "QUEUED" || job.status === "RUNNING";
  const outcome = result && !active && job.status === "SUCCEEDED" ? OUTCOMES[result.outcome] : null;

  const passed = outcome !== null && result?.outcome === "passed";
  const hintBox = (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <Label htmlFor={`hint-${job.id}`} className="text-xs">
        {passed
          ? "Want it changed? Tell the AI how"
          : "Tell the AI what it got wrong, or what it cannot see"}
      </Label>
      <Textarea
        id={`hint-${job.id}`}
        rows={3}
        value={hint}
        onChange={(e) => setHint(e.target.value)}
        placeholder={
          passed
            ? "e.g. Also check that the phone number is saved."
            : 'e.g. Click "New", then the "Customer" button (it is a button, not a menu item). The form has English Name, Khmer Name and Phone; save with "Save".'
        }
        className="text-sm"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={continuing || hint.trim().length < 3}
        onClick={async () => {
          if (!onContinue) return;
          setContinuing(true);
          try {
            if (await onContinue(hint.trim())) setHint("");
          } finally {
            setContinuing(false);
          }
        }}
      >
        {continuing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
        {passed ? "Improve it" : "Keep trying"}
      </Button>
      <p className="text-xs text-muted-foreground">
        {job.status === "FAILED"
          ? "This job broke before it finished. The AI picks up from its last finished script instead, with three more tries."
          : "The AI picks up from this script and where it stopped, with three more tries."}
      </p>
    </div>
  );

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Sparkles className="size-4 text-primary" />
        AI
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
        {active && onCancel && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7"
            disabled={cancelling}
            onClick={async () => {
              setCancelling(true);
              try {
                await onCancel();
              } finally {
                setCancelling(false);
              }
            }}
          >
            {cancelling ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <X className="mr-1.5 size-3.5" />}
            Cancel
          </Button>
        )}
      </div>

      {active && job.progressTotal > 0 && (
        <Progress value={(job.progressDone / job.progressTotal) * 100} className="h-1.5" />
      )}

      {active && result?.currentRunId && (
        <LiveView runId={result.currentRunId} quietWhenEmpty />
      )}

      {result && result.attempts.length > 0 && (
        <AttemptList
          projectId={projectId}
          attempts={result.attempts}
          // Once it passes, the road there matters less: fold it away.
          folded={!active && job.status === "SUCCEEDED" && result.outcome === "passed"}
        />
      )}

      {job.status === "FAILED" && (
        // Cancelling is a choice, not a failure: say it plainly.
        <p className={job.error?.startsWith("Cancelled") ? "text-muted-foreground" : "text-status-failed"}>
          {job.error}
        </p>
      )}
      {job.status === "FAILED" && onContinue && hintBox}

      {outcome && result && (
        <>
          <p className={cn("flex items-start gap-2 rounded-md border px-3 py-2", outcome.tone)}>
            <outcome.icon className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-medium">{outcome.label}</span>
              {result.notes && <span className="block text-foreground/80">{result.notes}</span>}
            </span>
          </p>
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Show the script the AI wrote
              {lastFailure && failingLine && (
                <span className="text-status-failed"> — failed at line {failingLine}</span>
              )}
            </summary>
            <CodeView
              className="mt-1"
              code={result.code}
              errorLine={failingLine}
              errorText={lastFailure ? errorHeadline(lastFailure.error) : undefined}
            />
          </details>
          {onContinue && hintBox}
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

type Attempt = ScriptWritingResult["attempts"][number];

/**
 * Claude's tries, one per row: how each run went, where it failed, and what
 * Claude changed to get there. After a pass, folded to one line.
 */
function AttemptList({
  projectId,
  attempts,
  folded,
}: {
  projectId: string;
  attempts: Attempt[];
  folded: boolean;
}) {
  const [open, setOpen] = useState(!folded);
  const own = attempts.filter((a) => !a.earlier);
  const failedBefore = own.length - 1;

  if (folded && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="size-3.5" />
        <span className="font-medium text-status-passed">
          Passed on try {own.length}
        </span>
        {failedBefore > 0 && `after ${failedBefore} failed ${failedBefore === 1 ? "try" : "tries"}`}
        <span className="underline">show the tries</span>
      </button>
    );
  }

  return (
    <div className="space-y-1">
      {folded && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="size-3.5" />
          Hide the tries
        </button>
      )}
      <ol className="space-y-2">
        {attempts.map((attempt, index) => {
          const label = attempt.earlier
            ? "Starting script"
            : `Try ${attempts.slice(0, index + 1).filter((a) => !a.earlier).length}`;
          const before = index > 0 ? attempts[index - 1] : undefined;
          const changes = before && !attempt.earlier ? diffLines(before.code, attempt.code) : [];
          const changed = Math.max(
            changes.filter((line) => line.kind === "added").length,
            changes.filter((line) => line.kind === "removed").length,
          );
          const line = attempt.error ? findErrorLine(attempt.code, attempt.error) : null;
          const timedOut = attempt.error?.startsWith("Timed out");
          return (
            <li key={attempt.runId} className="text-xs">
              {/* One line whatever the error's length: it truncates, and
                  the full text is on hover and in the run. */}
              <div className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
                <RunStatusBadge status={attempt.status} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={attempt.error ?? undefined}>
                  {attempt.status === "PASSED" ? (
                    // Older tries have no duration recorded.
                    attempt.durationMs != null ? `in ${formatDuration(attempt.durationMs)}` : ""
                  ) : (
                    <>
                      {line && <span className="font-medium text-status-failed">line {line}: </span>}
                      {timedOut
                        ? `timed out after ${formatDuration(attempt.durationMs ?? 60_000)}`
                        : errorHeadline(attempt.error)}
                    </>
                  )}
                </span>
                <Link
                  href={`/projects/${projectId}/automation/runs/${attempt.runId}`}
                  className="shrink-0 text-primary hover:underline"
                >
                  Open run ›
                </Link>
              </div>
              {(attempt.change || changed > 0) && (
                <p className="mt-0.5 pl-[6.5rem] text-muted-foreground">
                  {attempt.change}
                  {attempt.change && changed > 0 && " · "}
                  {changed > 0 && `${changed} line${changed === 1 ? "" : "s"} changed`}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
