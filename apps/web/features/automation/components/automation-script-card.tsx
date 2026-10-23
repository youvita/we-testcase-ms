"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Play, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ClaudeConnectionDialog } from "@/features/ai/components/claude-connection-dialog";
import { isJobActive, useAiJob } from "@/features/ai/use-ai-job";
import type { AiJobDto, Platform, RunEnvironmentDto, RunItemStatus } from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";
import { formatRelative } from "@/utils/format";

import { NewRunDialog } from "./new-run-dialog";
import { RunStatusBadge } from "./run-status-badge";
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

export type ScriptState = {
  code: string;
  updatedAt: string;
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
  lastResult,
  latestWriteJob,
  signInCases = [],
  canManage,
}: {
  projectId: string;
  testCaseId: string;
  platform: Platform;
  script: ScriptState;
  environments: RunEnvironmentDto[];
  lastResult: LastAutomatedResult;
  /** The newest "write with Claude" job for this case, finished or not. */
  latestWriteJob: AiJobDto | null;
  /** Other automated Web cases that can sign in before this one runs. */
  signInCases?: { id: string; tcId: string; title: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState(script?.code ?? "");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [writeOpen, setWriteOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);
  const [writeJob, setWriteJob] = useAiJob(latestWriteJob, (job) => {
    if (job.status === "SUCCEEDED") toast.success(job.summary ?? "Claude finished the script");
    else toast.error(job.error ?? "Claude could not write the script");
  });

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
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="size-4" />
            Automation
          </CardTitle>
          {lastResult && (
            <Link
              href={`/projects/${projectId}/automation/runs/${lastResult.runId}`}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:underline"
            >
              Last run #{lastResult.runNumber}
              <RunStatusBadge status={lastResult.status} />
              {lastResult.finishedAt && formatRelative(lastResult.finishedAt)}
            </Link>
          )}
        </div>
        <CardDescription>
          {script
            ? `Playwright script · saved by ${script.updatedBy.name} ${formatRelative(script.updatedAt)}`
            : "Write this case as a Playwright script and the runner can execute it."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {writeJob && (
          <ScriptWritingPanel
            projectId={projectId}
            job={writeJob}
            savedCode={script?.code ?? null}
            onUse={(next) => {
              setCode(next);
              toast.message("Script placed in the editor — review it, then save.");
            }}
          />
        )}

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

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">What the script can use</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {platform === "WEB" ? (
              <li>
                <code className="font-mono">page</code>, <code className="font-mono">context</code>,{" "}
                <code className="font-mono">browser</code> — a Chromium page already pointed at the
                environment&apos;s Web base URL, so <code className="font-mono">page.goto(&quot;/login&quot;)</code> works.
                <code className="font-mono">request</code> is on the API base URL, for setting up data.
              </li>
            ) : (
              <li>
                <code className="font-mono">request</code> — an HTTP client on the environment&apos;s API base
                URL, so <code className="font-mono">request.get(&quot;/users&quot;)</code> works. No browser is
                started.
              </li>
            )}
            <li>
              <code className="font-mono">expect</code> — Playwright assertions. A failed assertion fails the
              case; a timeout does too.
            </li>
            <li>
              <code className="font-mono">vars.NAME</code> — the environment&apos;s variables, such as test
              accounts. <code className="font-mono">env.name</code>, <code className="font-mono">env.webUrl</code>,{" "}
              <code className="font-mono">env.apiUrl</code> describe where it runs.
            </li>
            <li>
              A script that crashes on its own mistake (TypeError, ReferenceError) is reported as a script
              error and does not mark the case failed.
            </li>
          </ul>
        </details>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={saving || !dirty || !code.trim()} onClick={() => void handleSave()}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
              Save script
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!script || dirty}
              title={dirty ? "Save the script first" : undefined}
              onClick={() => setRunOpen(true)}
            >
              <Play className="mr-2 size-4" />
              Run this case
            </Button>
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
            {!code && (
              <Button size="sm" variant="ghost" onClick={() => setCode(EXAMPLES[platform])}>
                Insert example
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

      <NewRunDialog
        projectId={projectId}
        environments={environments}
        signInCases={signInCases}
        testCaseIds={[testCaseId]}
        open={runOpen}
        onOpenChange={setRunOpen}
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
