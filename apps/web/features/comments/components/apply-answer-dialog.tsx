"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, Loader2, Sparkles } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/utils/api-client";
import type { CaseUpdateSuggestion } from "@wetestcase/dto";

/** The parts of a case a PO's answer changes. */
export type CaseText = {
  preconditions: string | null;
  steps: string | null;
  expectedResult: string | null;
  openQuestions: string | null;
};

/** Where the answer came from — and so how saving settles it. */
export type AnswerTarget =
  /** A question in the case's discussion: saving marks it dealt with. */
  | { kind: "comment"; questionId: string }
  /** A question on a requirement the case verifies: saving updates the case only. */
  | { kind: "requirement" };

type Field = keyof CaseText;

const FIELDS: { key: Field; label: string; rows: number; placeholder: string }[] = [
  { key: "preconditions", label: "Preconditions", rows: 3, placeholder: "None" },
  { key: "steps", label: "Steps", rows: 6, placeholder: "None" },
  {
    key: "expectedResult",
    label: "Expected result",
    rows: 5,
    placeholder: "What passes, as the PO confirmed it — the exact message, the limit, the rule…",
  },
  { key: "openQuestions", label: "Open questions", rows: 3, placeholder: "Nothing left to confirm" },
];

const asText = (text: CaseText): Record<Field, string> => ({
  preconditions: text.preconditions ?? "",
  steps: text.steps ?? "",
  expectedResult: text.expectedResult ?? "",
  openQuestions: text.openQuestions ?? "",
});

/**
 * Put a PO's answer into the case: the question and answers on top, the
 * case's text below to edit — filled with the AI's suggestion when there is
 * one, each changed field marked and one click from the text as it was —
 * so the confirmed rule ends up where testers, reports and the AI read it.
 */
export function ApplyAnswerDialog({
  open,
  onOpenChange,
  testCaseId,
  target,
  question,
  answers,
  caseText,
  suggestion = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testCaseId: string;
  target: AnswerTarget;
  question: string;
  /** The PO's answers to it, oldest first. */
  answers: { author: string; body: string }[];
  caseText: CaseText;
  suggestion?: CaseUpdateSuggestion | null;
}) {
  const router = useRouter();
  const current = asText(caseText);
  // From the suggestion, or the case as it is now: the dialog is mounted
  // afresh each time it opens, so this is where each opening starts.
  const [values, setValues] = useState(() => (suggestion ? asText(suggestion) : current));
  const [saving, setSaving] = useState(false);

  const unchanged = FIELDS.every(({ key }) => values[key].trim() === current[key].trim());

  function set(key: Field, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      if (target.kind === "comment") {
        await api.post(`/api/comments/${target.questionId}/settle`, { update: values });
      } else {
        await api.patch(`/api/test-cases/${testCaseId}/text`, values);
      }
      toast.success("Test case updated", {
        description: "If it has a script, run it again so it checks the confirmed result.",
      });
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Update the test case</DialogTitle>
          <DialogDescription>
            {suggestion
              ? "The AI suggested these changes from the PO's answer. Check them before saving — nothing is saved until you do."
              : "Put what the PO confirmed into the case. Testers, reports and the AI that writes scripts read the case, not the discussion."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
            <p>
              <span className="font-medium">Question: </span>
              <span className="preserve-lines">{question}</span>
            </p>
            {answers.map((answer, index) => (
              <p key={index} className="border-l-2 border-status-passed pl-2">
                <span className="font-medium text-status-passed">{answer.author}: </span>
                <span className="preserve-lines">{answer.body}</span>
              </p>
            ))}
          </div>

          {suggestion && (
            <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <p className="flex items-start gap-2">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{suggestion.summary || "The AI suggested an update."}</span>
              </p>
              {suggestion.newCaseIdea && (
                <p className="flex items-start gap-2 text-muted-foreground">
                  <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <span className="font-medium text-foreground">Consider a new case: </span>
                    {suggestion.newCaseIdea}
                  </span>
                </p>
              )}
            </div>
          )}

          {FIELDS.map(({ key, label, rows, placeholder }) => {
            const changed = values[key].trim() !== current[key].trim();
            const suggested = suggestion ? suggestion[key] : null;
            return (
              <div key={key} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor={`apply-${key}`}>{label}</Label>
                  {changed ? (
                    <span className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-primary">{suggestion ? "Changed" : "Edited"}</span>
                      <button
                        type="button"
                        className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        onClick={() => set(key, current[key])}
                      >
                        Keep current
                      </button>
                    </span>
                  ) : (
                    suggested !== null &&
                    suggested.trim() !== current[key].trim() && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        onClick={() => set(key, suggested)}
                      >
                        Use the AI&rsquo;s version
                      </button>
                    )
                  )}
                </div>
                <Textarea
                  id={`apply-${key}`}
                  rows={rows}
                  value={values[key]}
                  onChange={(event) => set(key, event.target.value)}
                  placeholder={placeholder}
                  className={changed ? "border-primary/50" : undefined}
                />
                {key === "openQuestions" && (
                  <p className="text-xs text-muted-foreground">
                    Remove the question this answer settles; keep any that are still open.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || unchanged} onClick={() => void save()}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Update test case
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
