"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { FixStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/utils/api-client";

/**
 * QA's step in the hand-off: claim a flagged fix as being retested.
 *
 * Only offered once a developer says a fix is ready, and it says nothing about
 * the outcome — recording the execution does that, and clears this back to
 * none, so the flag cannot be left stale.
 */
export function RetestButton({
  testCaseId,
  fixStatus,
}: {
  testCaseId: string;
  fixStatus: FixStatus;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (fixStatus !== "FIXED" && fixStatus !== "RETESTING") return null;
  const retesting = fixStatus === "RETESTING";

  async function update(next: FixStatus) {
    setPending(true);
    try {
      await api.patch(`/api/test-cases/${testCaseId}/fix-status`, {
        fixStatus: next,
      });
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant={retesting ? "outline" : "default"}
      size="sm"
      className="w-full"
      disabled={pending}
      onClick={() => update(retesting ? "FIXED" : "RETESTING")}
    >
      {pending ? (
        <Loader2 className="mr-2 size-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-2 size-4" />
      )}
      {retesting ? "Stop retesting" : "Start retesting"}
    </Button>
  );
}
