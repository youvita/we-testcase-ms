"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { FixStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  DEV_FIX_STATUSES,
  FIX_STATUS_HINTS,
  FIX_STATUS_LABELS,
  isClosingFixStatus,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/utils/api-client";
import { formatDateTime, formatRelative } from "@/utils/format";

/**
 * The developer's side of a failure: say where the fix stands without touching
 * the execution result.
 *
 * There is no "Passed" here by design. Only a recorded execution can make a
 * case pass, and recording one is QA's job — this panel exists so engineering
 * can answer a failure without that line being crossed.
 */
export function FixStatusPanel({
  testCaseId,
  fixStatus,
  fixStatusAt,
  fixStatusBy,
}: {
  testCaseId: string;
  fixStatus: FixStatus;
  fixStatusAt: Date | null;
  fixStatusBy: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<FixStatus | null>(null);
  // Which closing decision is awaiting its reason, if any.
  const [closing, setClosing] = useState<FixStatus | null>(null);
  const [note, setNote] = useState("");
  const [clearOpen, setClearOpen] = useState(false);

  /** Resolves false on failure — the caller decides whether that is fatal. */
  async function update(next: FixStatus, reason?: string): Promise<boolean> {
    setPending(next);
    try {
      await api.patch(`/api/test-cases/${testCaseId}/fix-status`, {
        fixStatus: next,
        note: reason,
      });
      setClosing(null);
      setNote("");
      router.refresh();
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    } finally {
      setPending(null);
    }
  }

  function choose(option: FixStatus, selected: boolean) {
    // Selecting the current value again clears it, so a premature "fixed" can
    // be retracted without waiting for a retest.
    if (selected) return update("NONE");

    // Closing a case overrules a reported failure, so it asks for a reason
    // first rather than committing on the click.
    if (isClosingFixStatus(option)) {
      setClosing(option);
      setNote("");
      return;
    }
    return update(option);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Developer update</CardTitle>
        <CardDescription>
          Tell QA where this stands. It does not change the test result — only a
          recorded execution can do that.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid gap-2">
          {DEV_FIX_STATUSES.map((option) => {
            const selected = fixStatus === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                disabled={pending !== null}
                // Selecting the current value again clears it, so a premature
                // "fixed" can be retracted without waiting for a retest.
                onClick={() => choose(option, selected)}
                className={cn(
                  "rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60",
                  selected && "border-primary bg-primary/5",
                  closing === option && "border-primary",
                )}
              >
                <span className="flex items-center justify-between gap-2 font-medium">
                  {FIX_STATUS_LABELS[option]}
                  {pending === option && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {FIX_STATUS_HINTS[option]}
                </span>
              </button>
            );
          })}
        </div>

        {closing && (
          <div className="space-y-2 rounded-md border border-primary/40 bg-muted/40 p-3">
            <Label htmlFor="fix-status-note" className="text-xs">
              Why {FIX_STATUS_LABELS[closing].toLowerCase()}?
            </Label>
            <Textarea
              id="fix-status-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="QA and anyone reading this case later will see this."
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pending !== null}
                onClick={() => {
                  setClosing(null);
                  setNote("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={pending !== null || !note.trim()}
                onClick={() => update(closing, note.trim())}
              >
                {pending !== null && (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                )}
                Save reason
              </Button>
            </div>
          </div>
        )}

        {fixStatus !== "NONE" && (
          <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">
              Set by {fixStatusBy?.name ?? "someone"}
              {fixStatusAt ? ` · ${formatDateTime(fixStatusAt)}` : ""}
            </span>
            {/* Asks first: one stray click here would otherwise wipe the whole
                round — including a retest another person is in the middle of. */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2"
              disabled={pending !== null}
              onClick={() => setClearOpen(true)}
            >
              Clear
            </Button>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={
          fixStatus === "RETESTING"
            ? `Clear the retest ${fixStatusBy?.name ?? "someone"} started?`
            : "Clear this update?"
        }
        description={
          <div className="space-y-2">
            {fixStatus === "RETESTING" ? (
              <p>
                {fixStatusBy?.name ?? "Someone"} claimed this retest
                {fixStatusAt ? ` ${formatRelative(fixStatusAt)}` : ""} and may
                still be running it.
              </p>
            ) : (
              <p>
                <strong>{FIX_STATUS_LABELS[fixStatus]}</strong>, set by{" "}
                {fixStatusBy?.name ?? "someone"}
                {fixStatusAt ? ` on ${formatDateTime(fixStatusAt)}` : ""}.
              </p>
            )}
            <p>
              Clearing ends this round: the status and its author come off the
              case, and nobody is notified. The progress timeline keeps the
              history, and the recorded test result is not affected.
            </p>
          </div>
        }
        confirmLabel="Clear update"
        onConfirm={async () => {
          // Throwing keeps the dialog open; `update` has already toasted why.
          if (!(await update("NONE"))) throw new Error("Clear failed");
        }}
      />
    </Card>
  );
}
