"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { FixStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { api, errorMessage } from "@/utils/api-client";
import { formatDateTime, formatRelative } from "@/utils/format";

/**
 * QA's step in the hand-off: claim a flagged fix as being retested.
 *
 * Only offered once a developer says a fix is ready, and it says nothing about
 * the outcome — recording the execution does that, and clears this back to
 * none, so the flag cannot be left stale.
 *
 * Stopping someone else's retest — an Admin's override, or a second QA — asks
 * first. A stray click would otherwise wipe a claim while the tester who made
 * it is still working, and nothing in the UI would tell them it had gone.
 * Stopping your own claim stays one click: you know what you started.
 */
export function RetestButton({
  testCaseId,
  fixStatus,
  claimedBy,
  claimedAt,
  currentUserId,
}: {
  testCaseId: string;
  fixStatus: FixStatus;
  /** Who set the current flag, when it is a retest claim. */
  claimedBy?: { id: string; name: string } | null;
  claimedAt?: Date | string | null;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (fixStatus !== "FIXED" && fixStatus !== "RETESTING") return null;
  const retesting = fixStatus === "RETESTING";
  const isOwnClaim = !claimedBy || claimedBy.id === currentUserId;

  async function update(next: FixStatus) {
    setPending(true);
    try {
      await api.patch(`/api/test-cases/${testCaseId}/fix-status`, {
        fixStatus: next,
      });
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant={retesting ? "outline" : "default"}
        size="sm"
        className="w-full"
        disabled={pending}
        onClick={() => {
          if (retesting && !isOwnClaim) {
            setConfirmOpen(true);
            return;
          }
          void update(retesting ? "FIXED" : "RETESTING").catch(() => {});
        }}
      >
        {pending ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 size-4" />
        )}
        {retesting ? "Stop retesting" : "Start retesting"}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Stop the retest ${claimedBy?.name ?? "someone else"} started?`}
        description={
          <div className="space-y-2">
            <p>
              {claimedBy?.name ?? "Another tester"} claimed this retest
              {claimedAt ? ` ${formatRelative(claimedAt)}` : ""}
              {claimedAt ? ` (${formatDateTime(claimedAt)})` : ""} and may still
              be running it.
            </p>
            <p>
              Stopping puts the case back to <strong>Fix ready</strong> and
              removes their claim from the progress timeline. Nothing tells them
              it has gone.
            </p>
          </div>
        }
        confirmLabel="Stop retesting"
        onConfirm={() => update("FIXED")}
      />
    </>
  );
}
