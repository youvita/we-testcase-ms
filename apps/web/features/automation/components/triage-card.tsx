"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bug, ClipboardCopy, Code2, Server, Sparkles, HelpCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { cn } from "@/lib/utils";
import type { RunTriageDto, TriageCategory } from "@wetestcase/dto";
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
  testCaseId,
  canManage,
}: {
  triage: RunTriageDto;
  testCaseId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [applyOpen, setApplyOpen] = useState(false);
  const category = CATEGORIES[triage.category];

  async function applyFix() {
    try {
      await api.put(`/api/test-cases/${testCaseId}/script`, { code: triage.fixedCode });
      toast.success("Script updated — run the case again to confirm");
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
        <span className="ml-auto text-xs text-muted-foreground">Claude · {formatRelative(triage.triagedAt)}</span>
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
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Corrected script</summary>
          <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-background p-3 font-mono text-xs">{triage.fixedCode}</pre>
          {canManage && (
            <Button size="sm" className="mt-2" onClick={() => setApplyOpen(true)}>
              <Code2 className="mr-2 size-4" />
              Apply fixed script
            </Button>
          )}
        </details>
      )}

      <ConfirmDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        title="Replace the case's script?"
        description="The corrected script replaces the one saved on the test case. Past runs keep what they ran."
        confirmLabel="Replace script"
        destructive={false}
        onConfirm={applyFix}
      />
    </div>
  );
}
