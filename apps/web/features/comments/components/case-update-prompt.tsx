"use client";

import { useState } from "react";
import { FilePenLine, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { isJobActive, useAiJob } from "@/features/ai/use-ai-job";
import { api, errorMessage } from "@/utils/api-client";
import type { AiJobDto, CaseUpdateSuggestion } from "@wetestcase/dto";

import { ApplyAnswerDialog, type AnswerTarget, type CaseText } from "./apply-answer-dialog";

/**
 * After the PO's answer: put it into the case. The AI can suggest the
 * update — QA reviews it before anything is saved — or QA edits it alone.
 */
export function CaseUpdatePrompt({
  testCaseId,
  source,
  question,
  answers,
  caseText,
  onNoChange,
  quiet = false,
}: {
  testCaseId: string;
  /** The question answered: in the case's discussion, or on a requirement it verifies. */
  source: { kind: "comment" | "requirement"; questionId: string };
  question: string;
  answers: { author: string; body: string }[];
  caseText: CaseText;
  /** Record that the answer needs no change — for a question in the case's discussion. */
  onNoChange?: () => Promise<void>;
  /**
   * The answer was already dealt with (resolved, or settled): offer the
   * update quietly, for when it turns out the case still needs it.
   */
  quiet?: boolean;
}) {
  const [dialog, setDialog] = useState<{ suggestion: CaseUpdateSuggestion | null } | null>(null);
  const [starting, setStarting] = useState(false);
  const [settling, setSettling] = useState(false);
  const [job, setJob] = useAiJob(null, (finished: AiJobDto) => {
    if (finished.status === "SUCCEEDED" && finished.result) {
      setDialog({ suggestion: finished.result as CaseUpdateSuggestion });
    } else if (finished.status === "FAILED") {
      toast.error("The AI could not suggest an update", { description: finished.error ?? undefined });
    }
  });
  const drafting = starting || isJobActive(job);
  const target: AnswerTarget =
    source.kind === "comment" ? { kind: "comment", questionId: source.questionId } : { kind: "requirement" };

  async function suggest() {
    setStarting(true);
    try {
      setJob(await api.post<AiJobDto>(`/api/test-cases/${testCaseId}/suggest-update`, { source }));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    if (!job) return;
    try {
      setJob(await api.post<AiJobDto>(`/api/ai-jobs/${job.id}/cancel`));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function noChange() {
    if (!onNoChange) return;
    setSettling(true);
    try {
      await onNoChange();
    } finally {
      setSettling(false);
    }
  }

  return (
    <li
      className={
        quiet
          ? "ml-9 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
          : "ml-9 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
      }
    >
      {!quiet && <FilePenLine className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      {drafting ? (
        <>
          <span className={`mr-auto flex items-center gap-2 text-muted-foreground ${quiet ? "text-xs" : "text-sm"}`}>
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            The AI is drafting the update…
          </span>
          <Button size="sm" variant="ghost" className="h-7" disabled={!job} onClick={() => void cancel()}>
            Cancel
          </Button>
        </>
      ) : quiet ? (
        <>
          <span>Update the test case from this answer:</span>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => void suggest()}>
            <Sparkles className="mr-1 size-3" />
            Suggest with AI
          </Button>
          <span aria-hidden>·</span>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => setDialog({ suggestion: null })}>
            Edit myself
          </Button>
        </>
      ) : (
        <>
          <span className="mr-auto text-sm">The PO answered. Update the test case?</span>
          <Button size="sm" className="h-7" onClick={() => void suggest()}>
            <Sparkles className="mr-1.5 size-3.5" />
            Suggest with AI
          </Button>
          <Button size="sm" variant="outline" className="h-7" onClick={() => setDialog({ suggestion: null })}>
            Edit myself
          </Button>
          {onNoChange && (
            <Button size="sm" variant="ghost" className="h-7" disabled={settling} onClick={() => void noChange()}>
              {settling && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              No change needed
            </Button>
          )}
        </>
      )}

      {dialog && (
        <ApplyAnswerDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          testCaseId={testCaseId}
          target={target}
          question={question}
          answers={answers}
          caseText={caseText}
          suggestion={dialog.suggestion}
        />
      )}
    </li>
  );
}
