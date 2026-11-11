"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/utils/api-client";
import { formatRelative } from "@/utils/format";

export type ChangedRequirement = {
  id: string;
  code: string;
  title: string;
  docTitle: string;
  docVersion: number;
  changedAt: string;
};

/**
 * A requirement this case verifies changed after the case was written. QA
 * either edits the case (which clears this) or confirms it still holds.
 */
export function RequirementChangedNotice({
  projectId,
  testCaseId,
  requirements,
  canManage,
}: {
  projectId: string;
  testCaseId: string;
  requirements: ChangedRequirement[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (requirements.length === 0) return null;

  async function confirm() {
    setBusy(true);
    try {
      await api.delete(`/api/test-cases/${testCaseId}/requirement-changes`);
      toast.success("Marked as still correct");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-status-blocked/40 bg-status-blocked/5 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-status-blocked">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        {requirements.length === 1 ? "A requirement" : `${requirements.length} requirements`} this case
        verifies changed since it was written
      </p>
      <ul className="space-y-1 pl-6">
        {requirements.map((req) => (
          <li key={req.id}>
            <span className="font-mono text-xs">{req.code}</span> {req.title}
            <span className="text-muted-foreground">
              {" "}
              — {req.docTitle} v{req.docVersion}, {formatRelative(req.changedAt)}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/projects/${projectId}/requirements?tab=requirements&focus=${requirements[0]!.id}`}>See what changed</Link>
        </Button>
        {canManage && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void confirm()}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}
            Still correct
          </Button>
        )}
        <span className="text-xs text-muted-foreground">Editing the case also clears this.</span>
      </div>
    </div>
  );
}
