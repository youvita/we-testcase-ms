"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Code2, Download, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isJobActive, useAiJob } from "@/features/ai/use-ai-job";
import { downloadCaseScript } from "@/features/automation/download-scripts";
import type { AiJobDto, Platform, RunEnvironmentDto, ScriptWritingResult } from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";
import { formatRelative } from "@/utils/format";

import {
  ScriptStatusBadge,
  type LastAutomatedResult,
  type ScriptState,
} from "./automation-script-card";
import { NewRunDialog } from "./new-run-dialog";
import { RunStatusBadge } from "./run-status-badge";

/**
 * Where the case stands on automation, for the side column: is there a
 * script, can its failures be trusted, how did it last run — and a run
 * button. The script itself and Claude's work stay in the Automation card,
 * where there is room for code.
 */
export function AutomationSummary({
  projectId,
  testCaseId,
  platform,
  script,
  lastResult,
  latestWriteJob,
  environments,
  signInCases = [],
  canManage,
}: {
  projectId: string;
  testCaseId: string;
  platform: Platform;
  script: ScriptState;
  lastResult: LastAutomatedResult;
  latestWriteJob: AiJobDto | null;
  environments: RunEnvironmentDto[];
  signInCases?: { id: string; tcId: string; title: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [runOpen, setRunOpen] = useState(false);
  const [writeJob] = useAiJob(latestWriteJob);

  // Device runs do not exist yet; the side column has nothing to say.
  if (platform !== "WEB" && platform !== "API") return null;
  if (!script && !canManage) return null;

  const writing = isJobActive(writeJob);

  /**
   * Glide to the Script & Claude card rather than jump, and outline it for a
   * moment so it is clear where the page went.
   */
  function scrollToScript(event: React.MouseEvent<HTMLAnchorElement>) {
    const card = document.getElementById("automation");
    if (!card) return;
    event.preventDefault();
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.classList.add("ring-2", "ring-primary/40");
    window.setTimeout(() => card.classList.remove("ring-2", "ring-primary/40"), 1500);
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
  const tries = (writeJob?.result as ScriptWritingResult | null)?.attempts.filter((a) => !a.earlier).length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-4" />
          Automation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
          <dt className="text-muted-foreground">Script</dt>
          <dd>
            {script ? (
              <ScriptStatusBadge verified={Boolean(script.verifiedAt)} />
            ) : (
              <span className="text-muted-foreground">None yet</span>
            )}
          </dd>

          <dt className="text-muted-foreground">Last run</dt>
          <dd className="min-w-0">
            {lastResult ? (
              <Link
                href={`/projects/${projectId}/automation/runs/${lastResult.runId}`}
                className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 hover:underline"
              >
                <RunStatusBadge status={lastResult.status} />
                <span className="text-xs text-muted-foreground">
                  #{lastResult.runNumber}
                  {lastResult.finishedAt && ` · ${formatRelative(lastResult.finishedAt)}`}
                </span>
              </Link>
            ) : (
              <span className="text-muted-foreground">Not run yet</span>
            )}
          </dd>
        </dl>

        {writing && (
          <a
            href="#automation"
            onClick={scrollToScript}
            className="flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-xs text-primary hover:underline"
          >
            <Loader2 className="size-3.5 animate-spin" />
            Claude is writing the script{tries > 0 ? ` — try ${tries}` : "…"}
          </a>
        )}

        {script && !script.verifiedAt && (
          <p className="text-xs text-muted-foreground">
            A draft&apos;s failures are not recorded on the case — the script may be
            what is wrong. It becomes verified the first time it passes.
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

        <div className="flex flex-wrap gap-2">
          {canManage && script && (
            <Button
              size="sm"
              disabled={environments.length === 0}
              title={environments.length === 0 ? "Add an environment under Automation first" : undefined}
              onClick={() => setRunOpen(true)}
            >
              <Play className="mr-2 size-4" />
              Run this case
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <a href="#automation" onClick={scrollToScript}>
              <Code2 className="mr-2 size-4" />
              {script ? "Script & Claude" : "Write a script"}
            </a>
          </Button>
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
        </div>
      </CardContent>

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
    </Card>
  );
}
