"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Pencil, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OpenQuestions } from "@/components/shared/open-questions";
import { PlatformBadge, PriorityBadge, TestTypeBadge } from "@/components/shared/priority-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import type { ExecutionStatus, TestCaseListItem } from "@/types";
import { api, errorMessage } from "@/utils/api-client";
import { formatDateTime } from "@/utils/format";
import { splitOpenQuestions } from "@/utils/open-questions";

/** The parts of GET /api/test-cases/:id the quick view shows, as JSON gives them. */
type QuickCase = {
  id: string;
  tcId: string;
  title: string;
  preconditions: string | null;
  steps: string | null;
  expectedResult: string | null;
  openQuestions: string | null;
  executions: {
    id: string;
    status: ExecutionStatus;
    executedAt: string;
    actualResult: string | null;
    comment: string | null;
    environmentName: string | null;
    tester: { name: string };
  }[];
  requirements: {
    requirementChangedAt: string | null;
    requirement: { id: string; code: string; title: string; doc: { title: string; version: number } };
  }[];
};

/**
 * A test case's text at a glance, beside the list: no page change, and the
 * arrows (or ← →) step through the cases on this page.
 */
export function TestCaseQuickView({
  projectId,
  items,
  openId,
  onOpenChange,
  canManage,
  onEdit,
}: {
  projectId: string;
  /** The cases on this page, in the list's order. */
  items: TestCaseListItem[];
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  canManage: boolean;
  onEdit: (testCase: TestCaseListItem) => void;
}) {
  const [loaded, setLoaded] = useState<Record<string, QuickCase>>({});
  const [error, setError] = useState<string | null>(null);
  // The list was refreshed — after an edit, say: read the cases again.
  const [itemsSeen, setItemsSeen] = useState(items);
  if (items !== itemsSeen) {
    setItemsSeen(items);
    setLoaded({});
  }

  const index = openId ? items.findIndex((item) => item.id === openId) : -1;
  const item = index >= 0 ? items[index]! : null;
  const prev = index > 0 ? items[index - 1] : undefined;
  const next = index >= 0 && index < items.length - 1 ? items[index + 1] : undefined;
  const detail = openId ? loaded[openId] : undefined;

  useEffect(() => {
    if (!openId || loaded[openId]) return;
    let cancelled = false;
    setError(null);
    api
      .get<QuickCase>(`/api/test-cases/${openId}`)
      .then((testCase) => {
        if (!cancelled) setLoaded((current) => ({ ...current, [testCase.id]: testCase }));
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [openId, loaded]);

  const text = detail ? splitOpenQuestions(detail) : null;
  const latest = detail?.executions[0];
  const changed = detail?.requirements.filter((link) => link.requirementChangedAt) ?? [];
  const fullPage = item ? `/projects/${projectId}/test-cases/${item.id}` : "#";

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onOpenChange(null)}>
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
        onKeyDown={(event) => {
          // Not while typing somewhere in the panel.
          if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
          if (event.key === "ArrowLeft" && prev) onOpenChange(prev.id);
          if (event.key === "ArrowRight" && next) onOpenChange(next.id);
        }}
      >
        {item && (
          <>
            <SheetHeader className="space-y-2 border-b px-5 py-4 pr-12 text-left">
              <SheetDescription className="font-mono text-xs">
                {item.tcId} · {item.module.name}
                {item.subModule && ` › ${item.subModule}`}
              </SheetDescription>
              <SheetTitle className="text-base leading-snug">{item.title}</SheetTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={item.status} />
                <TestTypeBadge testType={item.testType} />
                <PriorityBadge priority={item.priority} />
                <PlatformBadge platform={item.platform} />
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
              {!detail && !error && (
                <div className="flex justify-center py-10">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {error && !detail && <p className="text-status-failed">{error}</p>}

              {detail && text && (
                <>
                  {changed.length > 0 && (
                    <p className="flex items-start gap-2 rounded-md border border-status-blocked/40 bg-status-blocked/5 px-3 py-2 text-status-blocked">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <span>
                        {changed.map((link) => link.requirement.code).join(", ")} changed since this case was
                        written — open the full page to check it.
                      </span>
                    </p>
                  )}

                  {!text.preconditions && !text.steps && !text.expectedResult ? (
                    <p className="text-muted-foreground">No preconditions, steps or expected result recorded.</p>
                  ) : (
                    <>
                      <Field label="Preconditions" value={text.preconditions} />
                      <Field label="Steps" value={text.steps} />
                      <Field label="Expected result" value={text.expectedResult} />
                    </>
                  )}
                  {text.openQuestions && <OpenQuestions text={text.openQuestions} />}

                  {detail.requirements.length > 0 && (
                    <Section label="Verifies requirements">
                      <ul className="space-y-1">
                        {detail.requirements.map(({ requirement, requirementChangedAt }) => (
                          <li key={requirement.id}>
                            <span className="font-mono text-xs">{requirement.code}</span> {requirement.title}
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              · {requirement.doc.title} v{requirement.doc.version}
                            </span>
                            {requirementChangedAt && (
                              <span className="ml-1.5 text-xs font-medium text-status-blocked">Changed</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  <Section label="Latest result">
                    {latest ? (
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={latest.status} />
                          <span className="text-xs text-muted-foreground">
                            {latest.tester.name} · {formatDateTime(latest.executedAt)}
                            {latest.environmentName && ` · ${latest.environmentName}`}
                          </span>
                        </div>
                        {latest.actualResult && <p className="whitespace-pre-wrap">{latest.actualResult}</p>}
                        {latest.comment && (
                          <p className="whitespace-pre-wrap text-muted-foreground">{latest.comment}</p>
                        )}
                        {detail.executions.length > 1 && (
                          <p className="text-xs text-muted-foreground">
                            {detail.executions.length - 1} earlier result
                            {detail.executions.length === 2 ? "" : "s"} on the full page.
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">Not run yet.</p>
                    )}
                  </Section>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={!prev}
                aria-label="Previous test case"
                title="Previous (←)"
                onClick={() => prev && onOpenChange(prev.id)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={!next}
                aria-label="Next test case"
                title="Next (→)"
                onClick={() => next && onOpenChange(next.id)}
              >
                <ChevronRight className="size-4" />
              </Button>
              <span className="text-xs text-muted-foreground">
                {index + 1} of {items.length} on this page
              </span>
              <div className="ml-auto flex gap-2">
                {canManage && (
                  <Button variant="outline" size="sm" onClick={() => onEdit(item)}>
                    <Pencil className="mr-1.5 size-3.5" />
                    Edit
                  </Button>
                )}
                <Button size="sm" asChild>
                  <Link href={fullPage}>
                    <ExternalLink className="mr-1.5 size-3.5" />
                    Open full page
                  </Link>
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <Section label={label}>
      <p className="whitespace-pre-wrap">{value}</p>
    </Section>
  );
}
