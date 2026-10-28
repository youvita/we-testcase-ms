"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitCompare, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RequirementDto, RequirementReviewInput } from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";
import { diffLines } from "@/utils/line-diff";

/**
 * What a new version of a document did to its requirements, and QA's say on
 * it. The comparison happens when the version is read
 * (services/requirement.service.ts); this only shows and settles it.
 */

/** A requirement QA has something to look at for the current version. */
export function needsAttention(req: RequirementDto): boolean {
  if (req.status === "REMOVED") return false;
  return req.change === "ADDED" || req.change === "CHANGED" || req.change === "MISSING" || req.possibleMatch !== null;
}

const BADGES = {
  ADDED: { label: "New", className: "border-status-passed/30 bg-status-passed/10 text-status-passed" },
  CHANGED: { label: "Changed", className: "border-status-blocked/30 bg-status-blocked/10 text-status-blocked" },
  MISSING: { label: "Not found", className: "border-status-failed/30 bg-status-failed/10 text-status-failed" },
  REMOVED: { label: "Removed", className: "border-border bg-muted text-muted-foreground" },
} as const;

export function ChangeBadge({ requirement }: { requirement: RequirementDto }) {
  const key =
    requirement.status === "REMOVED"
      ? "REMOVED"
      : requirement.change === "UNCHANGED" || requirement.change === null
        ? null
        : requirement.change;
  if (!key) return null;
  const badge = BADGES[key];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        badge.className,
      )}
    >
      {badge.label}
    </span>
  );
}

/** One line counting what the latest versions changed, with a way to see just those. */
export function ChangesBanner({
  requirements,
  onReview,
}: {
  requirements: RequirementDto[];
  onReview: () => void;
}) {
  const active = requirements.filter((req) => req.status === "ACTIVE");
  const count = (test: (req: RequirementDto) => boolean) => active.filter(test).length;
  const parts = [
    [count((req) => req.change === "ADDED"), "new"],
    [count((req) => req.change === "CHANGED"), "changed"],
    [count((req) => req.change === "MISSING"), "not found in the new text"],
    [count((req) => req.possibleMatch !== null), "may be renamed"],
  ] as const;
  if (parts.every(([n]) => n === 0)) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-status-blocked/30 bg-status-blocked/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2">
        <GitCompare className="mt-0.5 size-4 shrink-0 text-status-blocked" aria-hidden />
        <p>
          <span className="font-medium">A new document version changed requirements: </span>
          {parts
            .filter(([n]) => n > 0)
            .map(([n, label]) => `${n} ${label}`)
            .join(" · ")}
          . Check the test cases linked to them.
        </p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={onReview}>
        Review changes
      </Button>
    </div>
  );
}

/** The buttons for what QA has to settle on this requirement, if anything. */
export function ChangeReview({ requirement }: { requirement: RequirementDto }) {
  const router = useRouter();
  const [busy, setBusy] = useState<RequirementReviewInput["action"] | null>(null);

  async function review(action: RequirementReviewInput["action"], done: string) {
    setBusy(action);
    try {
      await api.post(`/api/requirements/${requirement.id}/review`, { action });
      toast.success(done);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const button = (action: RequirementReviewInput["action"], label: string, done: string, primary = false) => (
    <Button
      key={action}
      size="sm"
      variant={primary ? "default" : "outline"}
      className="h-7 px-2 text-xs"
      disabled={busy !== null}
      onClick={() => void review(action, done)}
    >
      {busy === action && <Loader2 className="mr-1 size-3 animate-spin" />}
      {label}
    </Button>
  );

  if (requirement.status === "REMOVED") return null;

  if (requirement.possibleMatch) {
    const earlier = requirement.possibleMatch;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          Same requirement as <span className="font-mono">{earlier.code}</span> ({earlier.title}) under a new code?
        </span>
        {button("merge", `Same as ${earlier.code}`, `Merged into ${earlier.code}'s history; its test cases now link here`, true)}
        {button("notSame", "Different requirement", "Kept as a new requirement")}
      </div>
    );
  }

  if (requirement.change === "MISSING") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Not found when the new version was read.</span>
        {button("remove", "Removed from the document", `${requirement.code} marked removed`, true)}
        {button("keep", "Still in force", `${requirement.code} kept`)}
      </div>
    );
  }

  return null;
}

const FIELDS = [
  ["title", "Title"],
  ["description", "Description"],
  ["acceptanceCriteria", "Acceptance criteria"],
] as const;

/** Before and after for a requirement the current version changed. */
export function ChangeDetail({ requirement }: { requirement: RequirementDto }) {
  const before = requirement.previous;
  if (requirement.change !== "CHANGED" || !before) return null;

  const fields = FIELDS.map(([key, label]) => ({
    label,
    lines: diffLines(before[key] ?? "", requirement[key] ?? ""),
  })).filter(({ lines }) => lines.some((line) => line.kind !== "same"));

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Changed in the current version
        {before.code !== requirement.code && (
          <span className="ml-2 normal-case tracking-normal">
            — code was <span className="font-mono">{before.code}</span>
          </span>
        )}
      </p>
      {fields.map(({ label, lines }) => (
        <div key={label} className="overflow-hidden rounded-md border bg-background text-xs">
          <p className="border-b bg-muted/50 px-3 py-1 font-medium text-muted-foreground">{label}</p>
          <div className="py-1">
            {lines.map((line, index) => (
              <div
                key={index}
                className={cn(
                  "whitespace-pre-wrap px-3",
                  line.kind === "removed" && "bg-status-failed/10 text-status-failed line-through decoration-status-failed/40",
                  line.kind === "added" && "bg-status-passed/10 text-status-passed",
                  line.kind === "same" && "text-muted-foreground",
                )}
              >
                <span className="mr-2 select-none opacity-60">
                  {line.kind === "removed" ? "−" : line.kind === "added" ? "+" : " "}
                </span>
                {line.text || " "}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
