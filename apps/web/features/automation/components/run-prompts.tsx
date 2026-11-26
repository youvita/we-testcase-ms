"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/utils/api-client";
import type { RunPromptDto } from "@wetestcase/dto";

const POLL_MS = 1500;

/**
 * A running script asking for a value — `ask("Enter the SMS code")` — shown
 * as an input box. The test waits; what is typed goes back to it. Polls only
 * while mounted, so mount it only while the run is active.
 */
export function RunPrompts({ runId, canAnswer }: { runId: string; canAnswer: boolean }) {
  const [prompts, setPrompts] = useState<RunPromptDto[]>([]);
  /** Closed with "Later": shown as a banner instead of the box. */
  const [later, setLater] = useState<string[]>([]);
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await api.get<RunPromptDto[]>(`/api/test-runs/${runId}/prompts`);
        if (!cancelled) setPrompts(next);
      } catch {
        // Retried on the next tick.
      }
      if (!cancelled) setNow(Date.now());
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId]);

  const current = prompts[0] ?? null;
  // A new question starts with an empty box.
  const currentId = current?.id;
  useEffect(() => setAnswer(""), [currentId]);

  if (!current) return null;
  const secondsLeft = Math.max(0, Math.round((Date.parse(current.expiresAt) - now) / 1000));
  const timeLeft = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;
  const boxOpen = canAnswer && !later.includes(current.id);

  async function send() {
    if (!current || !answer.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/test-runs/${runId}/prompts/${current.id}`, { answer });
      setPrompts((list) => list.filter((p) => p.id !== current.id));
      toast.success("Sent — the test goes on");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {!boxOpen && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <KeyRound className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{current.label}</span> is waiting for input: {current.question}
            <span className="text-muted-foreground"> · {timeLeft} left</span>
          </span>
          {canAnswer && (
            <Button size="sm" onClick={() => setLater((ids) => ids.filter((id) => id !== current.id))}>
              Answer
            </Button>
          )}
        </div>
      )}

      <Dialog open={boxOpen} onOpenChange={(open) => !open && setLater((ids) => [...ids, current.id])}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>The test needs your input</DialogTitle>
            <DialogDescription>
              {current.label} is paused, waiting for you. Type the value and it goes on from here.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="run-prompt-answer" className="block text-sm font-medium">
              {current.question}
            </label>
            <Input
              id="run-prompt-answer"
              autoFocus
              autoComplete="one-time-code"
              value={answer}
              maxLength={500}
              onChange={(event) => setAnswer(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {timeLeft} left. Kept secret: it is masked in the run&apos;s output.
            </p>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLater((ids) => [...ids, current.id])}>
              Later
            </Button>
            <Button disabled={sending || !answer.trim()} onClick={() => void send()}>
              {sending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
