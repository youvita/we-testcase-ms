"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, errorMessage } from "@/utils/api-client";
import { askedQuestions } from "@/utils/open-questions";
import type { PoQuestionDto } from "@wetestcase/dto";

/**
 * "Mark resolved" / "Reopen" on a question for the PO. Resolving a question
 * whose lines are still on its requirement's (or draft's) open questions asks
 * whether to take them off too — answered, they no longer wait on the PO, and
 * the test cases stop showing them as open.
 */
export function ResolveQuestionButton({
  question,
  openQuestions,
  className,
}: {
  question: PoQuestionDto;
  /** The open questions of what it was asked about — its requirement or draft. */
  openQuestions: string | null | undefined;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState<string[] | null>(null);
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const resolved = question.status === "resolved";

  async function send(next: boolean, removeOpenQuestions: string[] = []) {
    setBusy(true);
    try {
      await api.post(`/api/po-questions/${question.id}/resolve`, {
        resolved: next,
        ...(removeOpenQuestions.length ? { removeOpenQuestions } : {}),
      });
      if (removeOpenQuestions.length) {
        toast.success(
          `Resolved — ${removeOpenQuestions.length} open question${removeOpenQuestions.length === 1 ? "" : "s"} removed`,
        );
      }
      setChoosing(null);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function click() {
    if (resolved) return void send(false);
    const asked = askedQuestions(openQuestions, question.body);
    if (asked.length === 0) return void send(true);
    setRemove(new Set(asked));
    setChoosing(asked);
  }

  return (
    <>
      <button
        type="button"
        className={className ?? "shrink-0 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"}
        disabled={busy}
        onClick={click}
      >
        {busy && !choosing ? "…" : resolved ? "Reopen" : "Mark resolved"}
      </button>

      <Dialog open={choosing !== null} onOpenChange={(open) => !open && !busy && setChoosing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Remove from the open questions?</DialogTitle>
            <DialogDescription>
              This conversation asked these, and they are still listed as open. Remove the ones the PO
              settled — a decision like &ldquo;not defined&rdquo; settles one too. Keep any still waiting.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {(choosing ?? []).map((line) => (
              <li key={line}>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={remove.has(line)}
                    onCheckedChange={(checked) =>
                      setRemove((current) => {
                        const next = new Set(current);
                        if (checked) next.add(line);
                        else next.delete(line);
                        return next;
                      })
                    }
                  />
                  <span>{line}</span>
                </label>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => void send(true)}>
              Just resolve
            </Button>
            <Button disabled={busy || remove.size === 0} onClick={() => void send(true, [...remove])}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Resolve and remove {remove.size || ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
