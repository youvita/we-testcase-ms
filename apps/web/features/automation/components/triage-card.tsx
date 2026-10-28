"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bug,
  CheckCircle2,
  ClipboardCopy,
  Code2,
  HelpCircle,
  Loader2,
  Play,
  Server,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { cn } from "@/lib/utils";
import type { RunTriageDto, TestRunDto, TriageCategory } from "@wetestcase/dto";
import { diffLines } from "@/utils/line-diff";
import { api, errorMessage } from "@/utils/api-client";
import { formatRelative } from "@/utils/format";

const CATEGORIES: Record<TriageCategory, { label: string; icon: typeof Bug; tone: string }> = {
  product_bug: {
    label: "Product bug",
    icon: Bug,
    tone: "border-status-failed/30 bg-status-failed/10 text-status-failed",
  },
  script_issue: {
    label: "Script problem",
    icon: Code2,
    tone: "border-status-blocked/30 bg-status-blocked/10 text-status-blocked",
  },
  environment: {
    label: "Environment problem",
    icon: Server,
    tone: "border-border bg-muted text-muted-foreground",
  },
  unclear: {
    label: "Unclear",
    icon: HelpCircle,
    tone: "border-border bg-muted text-muted-foreground",
  },
};

/**
 * Claude's reading of a failure, with the one action each verdict calls for:
 * apply the corrected script, or copy a bug report for the developers.
 */
export function TriageCard({
  triage,
  projectId,
  testCase,
  ranCode,
  currentCode,
  environment,
  canManage,
}: {
  triage: RunTriageDto;
  projectId: string;
  testCase: { id: string; tcId: string };
  /** The script as it ran and failed — what the fix is compared with. */
  ranCode: string;
  /** The case's script now, to tell whether the fix has been applied. */
  currentCode: string | null;
  /** Where to run it again; null once the environment is gone. */
  environment: { id: string; name: string } | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [applyOpen, setApplyOpen] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const category = CATEGORIES[triage.category];
  const applied =
    Boolean(triage.fixedCode) && currentCode?.trim() === triage.fixedCode?.trim();
  const changes = triage.fixedCode ? diffLines(ranCode, triage.fixedCode) : [];
  const changedCount = changes.filter((line) => line.kind !== "same").length;

  async function runAgain() {
    if (!environment) return;
    setRerunning(true);
    try {
      const run = await api.post<TestRunDto>(`/api/projects/${projectId}/test-runs`, {
        environmentId: environment.id,
        scope: "cases",
        testCaseIds: [testCase.id],
      });
      router.push(`/projects/${projectId}/automation/runs/${run.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setRerunning(false);
    }
  }

  async function applyFix() {
    try {
      await api.put(`/api/test-cases/${testCase.id}/script`, { code: triage.fixedCode });
      toast.success(`Fixed script saved on ${testCase.tcId}`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  async function copyBugReport() {
    const report = triage.bugReport;
    if (!report) return;
    const text = `${report.title}\n\nSteps to reproduce:\n${report.steps}\n\nExpected:\n${report.expected}\n\nActual:\n${report.actual}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Bug report copied");
    } catch {
      toast.error("Could not copy — select the text instead");
    }
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium", category.tone)}>
          <category.icon className="size-3.5" />
          {category.label}
        </span>
        <span className="font-medium">{triage.summary}</span>
        <span className="ml-auto text-xs text-muted-foreground">AI · {formatRelative(triage.triagedAt)}</span>
      </div>
      {triage.explanation && <p className="whitespace-pre-wrap text-muted-foreground">{triage.explanation}</p>}

      {triage.bugReport && (
        <div className="space-y-1 rounded-md border bg-background p-3 text-xs">
          <p className="font-medium">{triage.bugReport.title}</p>
          <p className="whitespace-pre-wrap"><span className="text-muted-foreground">Steps: </span>{triage.bugReport.steps}</p>
          <p className="whitespace-pre-wrap"><span className="text-muted-foreground">Expected: </span>{triage.bugReport.expected}</p>
          <p className="whitespace-pre-wrap"><span className="text-muted-foreground">Actual: </span>{triage.bugReport.actual}</p>
          <Button size="sm" variant="outline" className="mt-1" onClick={() => void copyBugReport()}>
            <ClipboardCopy className="mr-2 size-4" />
            Copy bug report
          </Button>
        </div>
      )}

      {triage.fixedCode && (
        <div className="space-y-2">
          {applied && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-status-passed/30 bg-status-passed/10 px-3 py-2 text-sm">
              <CheckCircle2 className="size-4 text-status-passed" />
              <span>
                Applied — this is now {testCase.tcId}&apos;s script.
              </span>
              <Link
                href={`/projects/${projectId}/test-cases/${testCase.id}`}
                className="text-primary hover:underline"
              >
                Open test case
              </Link>
              {canManage && environment && (
                <Button size="sm" className="ml-auto" disabled={rerunning} onClick={() => void runAgain()}>
                  {rerunning ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Play className="mr-2 size-4" />}
                  Run again on {environment.name}
                </Button>
              )}
            </div>
          )}

          <details open={!applied}>
            <summary className="cursor-pointer text-xs text-muted-foreground">
              What changed — {changedCount} line{changedCount === 1 ? "" : "s"}, compared with the script that failed
            </summary>
            <div className="mt-1 max-h-80 overflow-auto rounded-md border bg-background py-2 font-mono text-xs">
              {changes.map((line, index) => (
                <div
                  key={index}
                  className={cn(
                    "whitespace-pre-wrap px-3",
                    line.kind === "removed" && "bg-status-failed/10 text-status-failed line-through decoration-status-failed/40",
                    line.kind === "added" && "bg-status-passed/10 text-status-passed",
                    line.kind === "same" && "text-muted-foreground",
                  )}
                >
                  <span className="mr-2 select-none opacity-60">
                    {line.kind === "removed" ? "−" : line.kind === "added" ? "+" : " "}
                  </span>
                  {line.text || " "}
                </div>
              ))}
            </div>
          </details>

          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Full corrected script</summary>
            <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-background p-3 font-mono text-xs">{triage.fixedCode}</pre>
          </details>

          {canManage && !applied && (
            <Button size="sm" onClick={() => setApplyOpen(true)}>
              <Code2 className="mr-2 size-4" />
              Apply fixed script to {testCase.tcId}
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        title={`Replace ${testCase.tcId}'s script?`}
        description="The corrected script replaces the one saved on the test case (Automation → Show script). Past runs keep what they ran."
        confirmLabel="Replace script"
        destructive={false}
        onConfirm={applyFix}
      />
    </div>
  );
}
