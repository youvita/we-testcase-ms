"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Code2,
  Loader2,
  PencilRuler,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CollapsibleCardHeader } from "@/components/shared/collapsible-card-header";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ClaudeConnectionDialog } from "@/features/ai/components/claude-connection-dialog";
import { isJobActive, useAiJob } from "@/features/ai/use-ai-job";
import type { AiJobDto, Platform, RunEnvironmentDto, RunItemStatus } from "@wetestcase/dto";
import { ApiError, api, errorMessage } from "@/utils/api-client";
import { formatRelative } from "@/utils/format";

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

/** Sent by the summary's Script & Claude link: open the card. */
export const OPEN_SCRIPT_CARD = "wtc:open-script-card";

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
 * The test case's Playwright script: edit, save, and run it on its own.
 *
 * The script is the body of a Playwright test; the runner wraps it. Mobile
 * cases get an explanation instead of an editor until device runs exist.
 */
export function AutomationScriptCard({
  projectId,
  testCaseId,
  platform,
  script,
  environments,
  latestWriteJob,
  lastFinishedWriteJobId = null,
  canManage,
}: {
  projectId: string;
  testCaseId: string;
  platform: Platform;
  script: ScriptState;
  environments: RunEnvironmentDto[];
  /** The newest "write with Claude" job for this case, finished or not. */
  latestWriteJob: AiJobDto | null;
  /** The newest one that finished — where "Keep trying" resumes after a broken job. */
  lastFinishedWriteJobId?: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState(script?.code ?? "");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Hidden until asked for: the summary beside the case already says
  // whether it is automated and how it last ran.
  const [showScript, setShowScript] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);
  const [writeJob, setWriteJob] = useAiJob(latestWriteJob, (job) => {
    if (job.status === "SUCCEEDED") toast.success(job.summary ?? "Claude finished the script");
    else toast.error(job.error ?? "Claude could not write the script");
  });
  // Closed by default: the summary beside the case covers what most people
  // need. Opened by its header, or by the summary's Script & Claude link.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (window.location.hash === "#automation") setExpanded(true);
    const open = () => setExpanded(true);
    window.addEventListener(OPEN_SCRIPT_CARD, open);
    return () => window.removeEventListener(OPEN_SCRIPT_CARD, open);
  }, []);

  if (platform !== "WEB" && platform !== "API") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="size-4" />
            Automation
          </CardTitle>
          <CardDescription>
            iOS and Android cases cannot be automated yet. The runner handles
            Web and API; device runs come in a later phase.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

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

  async function handleDelete() {
    try {
      await api.delete(`/api/test-cases/${testCaseId}/script`);
      setCode("");
      toast.success("Script removed");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  /** Keep Claude going from its last result with QA's hint. */
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
      toast.message("Claude is picking up from where it stopped…");
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
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab" || event.shiftKey) return;
    event.preventDefault();
    const target = event.currentTarget;
    const { selectionStart, selectionEnd } = target;
    const next = `${code.slice(0, selectionStart)}  ${code.slice(selectionEnd)}`;
    setCode(next);
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = selectionStart + 2;
    });
  }

  return (
    <Card id="automation" className="scroll-mt-20 transition-shadow duration-500">
      <CollapsibleCardHeader
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        title={
          <>
            <Code2 className="size-4" />
            Script &amp; Claude
          </>
        }
        description={
          <>
            <span>
              {script
                ? `Playwright script · saved by ${script.updatedBy.name} ${formatRelative(script.updatedAt)}`
                : "Write this case as a Playwright script and the runner can execute it."}
            </span>
            {/* What would otherwise be missed while it is closed. */}
            {!expanded && isJobActive(writeJob) && (
              <span className="inline-flex items-center gap-1 text-primary">
                <Loader2 className="size-3.5 animate-spin" />
                Claude is writing
              </span>
            )}
            {!expanded && dirty && <span className="text-status-blocked">· unsaved changes</span>}
          </>
        }
      />
      {expanded && (
        <CardContent className="space-y-3">
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
            />
          )}

          {editorOpen ? (
            <>
              <Textarea
                value={code}
                onChange={(event) => setCode(event.target.value)}
                onKeyDown={handleKeyDown}
                readOnly={!canManage}
                spellCheck={false}
                rows={Math.min(24, Math.max(8, code.split("\n").length + 1))}
                placeholder={EXAMPLES[platform]}
                className="font-mono text-xs leading-relaxed"
                aria-label="Playwright script"
              />
            </>
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

          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {editorOpen && (
                <Button size="sm" disabled={saving || !dirty || !code.trim()} onClick={() => void handleSave()}>
                  {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
                  Save script
                </Button>
              )}
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
                {script || code ? "Rewrite with Claude" : "Write with Claude"}
              </Button>
              {!script && !editorOpen && (
                <Button size="sm" variant="ghost" onClick={() => setShowScript(true)}>
                  <Code2 className="mr-2 size-4" />
                  Write it myself
                </Button>
              )}
              {editorOpen && !code && (
                <Button size="sm" variant="ghost" onClick={() => setCode(EXAMPLES[platform])}>
                  Insert example
                </Button>
              )}
              {editorOpen && script && !dirty && (
                <Button size="sm" variant="ghost" onClick={() => setShowScript(false)}>
                  Hide script
                </Button>
              )}
              {script && (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDeleteOpen(true)}>
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
          toast.message("Claude is on it — this takes a minute or two.");
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

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove the script?"
        description="The case goes back to manual. Past runs keep the script they ran."
        confirmLabel="Remove"
        onConfirm={handleDelete}
      />
    </Card>
  );
}
