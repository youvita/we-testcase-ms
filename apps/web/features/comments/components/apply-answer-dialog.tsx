"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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

export type CaseText = { expectedResult: string | null; openQuestions: string | null };

/**
 * Put a PO's answer into the case: the question and answer on top, the case's
 * expected result and open questions below to edit, so the confirmed rule ends
 * up where testers, reports and the AI read it.
 */
export function ApplyAnswerDialog({
  open,
  onOpenChange,
  questionId,
  question,
  answers,
  caseText,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questionId: string;
  question: string;
  /** The PO's answers to it, oldest first. */
  answers: { author: string; body: string }[];
  caseText: CaseText;
}) {
  const router = useRouter();
  const [expectedResult, setExpectedResult] = useState(caseText.expectedResult ?? "");
  const [openQuestions, setOpenQuestions] = useState(caseText.openQuestions ?? "");
  const [saving, setSaving] = useState(false);

  const unchanged =
    expectedResult.trim() === (caseText.expectedResult ?? "").trim() &&
    openQuestions.trim() === (caseText.openQuestions ?? "").trim();

  function handleOpenChange(next: boolean) {
    if (saving) return;
    if (next) {
      // Start from the case as it is now, not as it was when last opened.
      setExpectedResult(caseText.expectedResult ?? "");
      setOpenQuestions(caseText.openQuestions ?? "");
    }
    onOpenChange(next);
  }

  async function save() {
    setSaving(true);
    try {
      await api.post(`/api/comments/${questionId}/settle`, {
        update: { expectedResult, openQuestions },
      });
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Update the test case</DialogTitle>
          <DialogDescription>
            Put what the PO confirmed into the expected result. Testers, reports and the AI that
            writes scripts read the case, not the discussion.
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

          <div className="space-y-2">
            <Label htmlFor="apply-expected">Expected result</Label>
            <Textarea
              id="apply-expected"
              rows={6}
              autoFocus
              value={expectedResult}
              onChange={(event) => setExpectedResult(event.target.value)}
              placeholder="What passes, as the PO confirmed it — the exact message, the limit, the rule…"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apply-open-questions">Open questions</Label>
            <Textarea
              id="apply-open-questions"
              rows={3}
              value={openQuestions}
              onChange={(event) => setOpenQuestions(event.target.value)}
              placeholder="Nothing left to confirm"
            />
            <p className="text-xs text-muted-foreground">
              Remove the question this answer settles; keep any that are still open.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => handleOpenChange(false)}>
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
