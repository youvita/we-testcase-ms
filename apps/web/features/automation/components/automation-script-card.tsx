"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bot,
  Code2,
  Download,
  Loader2,
  PencilRuler,
  Play,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CollapsibleCardHeader } from "@/components/shared/collapsible-card-header";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ClaudeConnectionDialog } from "@/features/ai/components/claude-connection-dialog";
import { isJobActive, useAiJob } from "@/features/ai/use-ai-job";
import { downloadCaseScript } from "@/features/automation/download-scripts";
import {
  setScriptCardShown,
  useScriptCardShown,
} from "@/features/automation/script-card-visibility";
import type { AiJobDto, Platform, RunEnvironmentDto, RunItemStatus } from "@wetestcase/dto";
import { ApiError, api, errorMessage } from "@/utils/api-client";
import { formatRelative } from "@/utils/format";

import { NewRunDialog } from "./new-run-dialog";
import { RunStatusBadge } from "./run-status-badge";
import { ScriptEditor } from "./script-editor";
import { ScriptWritingPanel, WriteWithClaudeDialog } from "./script-writer";

const EXAMPLES: Record<"WEB" | "API", string> = {
  WEB: `await page.goto("/login");
await page.getByLabel("Email").fill(vars.USER_EMAIL);
await page.getByLabel("Password").fill(vars.USER_PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();

await expect(page.getByText("Welcome")).toBeVisible();`,
  API: `const response = await request.post("/auth/login", {
  data: { email: vars.USER_EMAIL, password: "wrong-password" },
});

expect(response.status()).toBe(401);
expect(await response.json()).toMatchObject({ error: expect.any(String) });`,
};

/** Verified (its failures count) or Draft (it has not passed yet). */
export function ScriptStatusBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-status-passed/30 bg-status-passed/10 px-2 py-0.5 text-xs font-medium text-status-passed">
      <ShieldCheck className="size-3.5" />
      Verified
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-status-blocked/30 bg-status-blocked/10 px-2 py-0.5 text-xs font-medium text-status-blocked"
      title="Its failures are not recorded on the case until it passes once"
    >
      <PencilRuler className="size-3.5" />
      Draft
    </span>
  );
}

export type ScriptState = {
  code: string;
  updatedAt: string;
  /** Null while the script is a draft. */
  verifiedAt: string | null;
  updatedBy: { id: string; name: string };
} | null;

export type LastAutomatedResult = {
  status: RunItemStatus;
  runId: string;
  runNumber: number | null;
  finishedAt: string | null;
} | null;

/**
 * Everything about automating the case, shown when the Test case card's
 * Automation button asks for it: where the script stands (verified, last
 * run), running and downloading it, the AI's tries, and the editor.
 *
 * The script is the body of a Playwright test; the runner wraps it. Mobile
 * cases get an explanation instead until device runs exist.
 */
export function AutomationScriptCard({
  projectId,
  testCaseId,
  platform,
  script,
  environments,
  lastResult,
  latestWriteJob,
  lastFinishedWriteJobId = null,
  signInCases = [],
  canManage,
}: {
  projectId: string;
  testCaseId: string;
  platform: Platform;
  script: ScriptState;
  environments: RunEnvironmentDto[];
  lastResult: LastAutomatedResult;
  /** The newest "write with AI" job for this case, finished or not. */
  latestWriteJob: AiJobDto | null;
  /** The newest one that finished — where "Keep trying" resumes after a broken job. */
  lastFinishedWriteJobId?: string | null;
  /** Other automated Web cases that can sign in before this one runs. */
  signInCases?: { id: string; tcId: string; title: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState(script?.code ?? "");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  // The code itself stays folded until asked for.
  const [showScript, setShowScript] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);
  const [writeJob, setWriteJob] = useAiJob(latestWriteJob, (job) => {
    if (job.status === "SUCCEEDED") toast.success(job.summary ?? "The AI finished the script");
    else toast.error(job.error ?? "The AI could not write the script");
  });

  // A case with automation — a saved script, or the AI's work on one — always
  // has this card, opened and closed by its header (closed by default). A
  // case with neither shows it only once the Test case card's Automation
  // button adds it, or when a link points here.
  const hasScript = Boolean(script);
  const hasAutomation = hasScript || Boolean(writeJob);
  const shown = useScriptCardShown();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (window.location.hash === "#automation") {
      setScriptCardShown(true);
      setExpanded(true);
    }
    // Leaving the case (prev/next) starts the next one hidden again.
    return () => setScriptCardShown(false);
  }, [testCaseId]);
  // Shown by the Automation button: open, ready to write.
  useEffect(() => {
    if (shown) setExpanded(true);
  }, [shown]);
  const writing = isJobActive(writeJob);
  useEffect(() => {
    if (!writing) return;
    setScriptCardShown(true);
    setExpanded(true);
  }, [writing]);

  if (platform !== "WEB" && platform !== "API") return null;
  if (!hasAutomation && !shown) return null;
  // The header only opens and closes the card. Whether a case without a
  // script has the card at all is the Automation button's call.
  const open = expanded;

  const header = (description: React.ReactNode) => (
    <CollapsibleCardHeader
      expanded={open}
      onToggle={() => setExpanded(!expanded)}
      title={
        <>
          <Bot className="size-4" />
          Automation
          {script && <ScriptStatusBadge verified={Boolean(script.verifiedAt)} />}
        </>
      }
      description={description}
    />
  );

  const dirty = code !== (script?.code ?? "");
  if (!canManage && !script) return null;
  // Unsaved changes are never hidden.
  const editorOpen = showScript || dirty;
  const lineCount = (script?.code ?? "").split("\n").length;

  async function handleSave() {
    setSaving(true);
    try {
      await api.put(`/api/test-cases/${testCaseId}/script`, { code });
      toast.success("Script saved");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  /** Take the card off a case without a script; any draft typed goes too. */
  function removeCard() {
    setCode("");
    setShowScript(false);
    setScriptCardShown(false);
  }

  /** Clear the AI's tries on this case: with the script, nothing is left. */
  async function discardAiWork() {
    await api.delete(`/api/test-cases/${testCaseId}/script/jobs`);
    setWriteJob(null);
  }

  async function handleDelete() {
    if (!script) {
      if (writeJob) {
        try {
          await discardAiWork();
          toast.success("The AI's drafts were discarded");
          router.refresh();
        } catch (error) {
          toast.error(errorMessage(error));
          throw error;
        }
      }
      removeCard();
      return;
    }
    try {
      await api.delete(`/api/test-cases/${testCaseId}/script`);
      if (writeJob) await discardAiWork();
      setCode("");
      // Back to a case without a script: the card goes, the button returns.
      setScriptCardShown(false);
      toast.success("Script removed");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  /** QA vouches for the script: from now on its failures count. */
  async function markVerified() {
    try {
      await api.post(`/api/test-cases/${testCaseId}/script/verify`);
      toast.success("Script verified — its failures will now be recorded");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  /** Stop the AI: it stops at its next step, and its script check is cancelled. */
  async function cancelWriting() {
    if (!writeJob) return;
    try {
      setWriteJob(await api.post<AiJobDto>(`/api/ai-jobs/${writeJob.id}/cancel`));
      toast.message("Cancelled — the AI stops at its next step.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  /** Keep the AI going from its last result with QA's hint. */
  async function continueWithHint(hint: string): Promise<boolean> {
    // A job that broke has no result of its own to continue; the last one
    // that finished does.
    const fromJobId = writeJob?.status === "SUCCEEDED" ? writeJob.id : lastFinishedWriteJobId;
    if (!fromJobId) return false;
    try {
      const job = await api.post<AiJobDto>(`/api/test-cases/${testCaseId}/script/continue`, {
        jobId: fromJobId,
        hint,
      });
      setWriteJob(job);
      toast.message("The AI is picking up from where it stopped…");
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        retryRef.current = () => void continueWithHint(hint);
        setConnectOpen(true);
      } else {
        toast.error(errorMessage(error));
      }
      return false;
    }
  }

  /** Tab indents instead of leaving the editor. */
  return (
    <Card id="automation" className="scroll-mt-20">
      {header(
        script ? (
          <>
            <span>
              Playwright script · saved by {script.updatedBy.name} {formatRelative(script.updatedAt)}
            </span>
            <span aria-hidden>·</span>
            {/* The last real run — recorded on the case, unlike the AI's tries. */}
            {lastResult ? (
              <Link
                href={`/projects/${projectId}/automation/runs/${lastResult.runId}`}
                className="inline-flex items-center gap-1.5 hover:underline"
              >
                Last run
                <RunStatusBadge status={lastResult.status} />
                #{lastResult.runNumber}
                {lastResult.finishedAt && ` · ${formatRelative(lastResult.finishedAt)}`}
              </Link>
            ) : (
              <span>Not run yet</span>
            )}
            {!open && writing && (
              <span className="inline-flex items-center gap-1 text-primary">
                <Loader2 className="size-3.5 animate-spin" />
                The AI is writing
              </span>
            )}
            {!open && dirty && <span className="text-status-blocked">· unsaved changes</span>}
          </>
        ) : (
          "Write this case as a Playwright script and the runner can execute it."
        ),
      )}
      {open && (
        <CardContent className="space-y-3">
          {script && !script.verifiedAt && (
            <p className="text-xs text-muted-foreground">
              A draft&apos;s failures are not recorded on the case — the script may be what is
              wrong. It becomes verified the first time it passes.
              {canManage && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => void markVerified()}
                  >
                    Mark as verified now
                  </button>
                </>
              )}
            </p>
          )}

          {writeJob && (
            <ScriptWritingPanel
              projectId={projectId}
              job={writeJob}
              savedCode={script?.code ?? null}
              onUse={(next) => {
                setCode(next);
                setShowScript(true);
                toast.message("Script placed in the editor — review it, then save.");
              }}
              onContinue={
                canManage && (writeJob.status === "SUCCEEDED" || lastFinishedWriteJobId)
                  ? continueWithHint
                  : undefined
              }
              onCancel={canManage ? cancelWriting : undefined}
            />
          )}

          {editorOpen ? (
            <ScriptEditor
              value={code}
              onChange={setCode}
              platform={platform}
              variables={environments.flatMap((env) => env.variables)}
              readOnly={!canManage}
              placeholder={EXAMPLES[platform]}
              onSave={
                canManage
                  ? () => {
                      if (!saving && dirty && code.trim()) void handleSave();
                    }
                  : undefined
              }
            />
          ) : (
            script && (
              <button
                type="button"
                onClick={() => setShowScript(true)}
                className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/40"
              >
                <Code2 className="size-4" />
                Show script
                <span className="text-xs">· {lineCount} line{lineCount === 1 ? "" : "s"}</span>
              </button>
            )
          )}

          {(canManage || script) && (
            <div className="flex flex-wrap items-center gap-2">
              {canManage && script && (
                <Button
                  size="sm"
                  disabled={dirty || environments.length === 0}
                  title={
                    dirty
                      ? "Save the script first"
                      : environments.length === 0
                        ? "Add an environment under Automation first"
                        : undefined
                  }
                  onClick={() => setRunOpen(true)}
                >
                  <Play className="mr-2 size-4" />
                  Run this case
                </Button>
              )}
              {script && (
                <Button
                  size="sm"
                  variant="outline"
                  title="The saved script as a runnable Playwright file (.spec.ts)"
                  onClick={() => void downloadCaseScript(testCaseId)}
                >
                  <Download className="mr-2 size-4" />
                  Download script
                </Button>
              )}
              {canManage && editorOpen && (
                <Button size="sm" disabled={saving || !dirty || !code.trim()} onClick={() => void handleSave()}>
                  {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                  Save script
                </Button>
              )}
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isJobActive(writeJob)}
                  onClick={() => setWriteOpen(true)}
                >
                  {isJobActive(writeJob) ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 size-4" />
                  )}
                  {script || code ? "Rewrite with AI" : "Write with AI"}
                </Button>
              )}
              {canManage && !script && !editorOpen && (
                <Button size="sm" variant="ghost" onClick={() => setShowScript(true)}>
                  <Code2 className="mr-2 size-4" />
                  Write it myself
                </Button>
              )}
              {canManage && editorOpen && !code && (
                <Button size="sm" variant="ghost" onClick={() => setCode(EXAMPLES[platform])}>
                  Insert example
                </Button>
              )}
              {editorOpen && script && !dirty && (
                <Button size="sm" variant="ghost" onClick={() => setShowScript(false)}>
                  Hide script
                </Button>
              )}
              {canManage && (script || !isJobActive(writeJob)) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  title={script || writeJob ? "Take the case back to manual" : "Take this card away"}
                  // Nothing to lose without a script, the AI's work or a draft: no question.
                  onClick={() => (script || writeJob || code.trim() ? setDeleteOpen(true) : removeCard())}
                >
                  <Trash2 className="mr-2 size-4" />
                  Remove
                </Button>
              )}
            </div>
          )}
        </CardContent>
      )}

      <WriteWithClaudeDialog
        testCaseId={testCaseId}
        platform={platform}
        environments={environments}
        open={writeOpen}
        onOpenChange={setWriteOpen}
        onStarted={(job) => {
          setWriteJob(job);
          toast.message("The AI is on it — this takes a minute or two.");
        }}
        onNeedsSubscription={(retry) => {
          retryRef.current = retry;
          setConnectOpen(true);
        }}
      />

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

      {canManage && script && (
        <NewRunDialog
          projectId={projectId}
          environments={environments}
          signInCases={signInCases}
          testCaseIds={[testCaseId]}
          open={runOpen}
          onOpenChange={setRunOpen}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={script ? "Remove the script?" : writeJob ? "Discard the AI's script?" : "Discard this draft?"}
        description={
          !script ? (
            writeJob ? (
              "The AI's tries on this case are cleared and the case goes back to manual. The script checks it ran stay under Automation → Runs."
            ) : (
              "The script typed here has not been saved and will be lost."
            )
          ) : (
            <div className="space-y-2">
              {/* Spell out what a proven script is worth before it goes. */}
              {(script.verifiedAt || lastResult?.status === "PASSED") && (
                <p className="font-medium text-foreground">
                  {script.verifiedAt ? "This script is verified" : "This script works"}
                  {lastResult?.status === "PASSED"
                    ? ` and passed its last run${lastResult.runNumber ? ` (#${lastResult.runNumber})` : ""}.`
                    : "."}
                </p>
              )}
              <p>
                The case goes back to manual. Past runs keep the script they ran.
                {writeJob && " The AI's tries on this case are cleared too."}
              </p>
            </div>
          )
        }
        confirmLabel="Remove"
        onConfirm={handleDelete}
      />
    </Card>
  );
}
