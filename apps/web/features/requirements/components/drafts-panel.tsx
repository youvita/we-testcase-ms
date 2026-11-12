"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleHelp,
  ChevronDown,
  ChevronRight,
  Compass,
  FileText,
  Inbox,
  Loader2,
  Pencil,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { OpenQuestions } from "@/components/shared/open-questions";
import { AskPoDialog } from "@/features/comments/components/ask-po-dialog";
import { PaginationControls } from "@/components/shared/pagination-controls";
import {
  PriorityBadge,
  TestTypeBadge,
} from "@/components/shared/priority-badge";
import {
  PLATFORM_LABELS,
  PLATFORMS,
  PRIORITIES,
  PRIORITY_LABELS,
  TEST_TYPES,
  TEST_TYPE_LABELS,
} from "@/lib/constants";
import type {
  DraftReviewResult,
  Platform,
  PoQuestionDto,
  TestCaseDraftDto,
  TestCaseDraftInput,
} from "@wetestcase/dto";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/utils/api-client";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { formatRelative } from "@/utils/format";

import { PoQuestionBadge, PoQuestions, type PoContext } from "./po-questions";

/**
 * AI-written test cases, waiting for a person.
 *
 * Accept turns a draft into a real test case (in its module, created if
 * needed, with a TC ID derived from its requirement and the traceability
 * links). Reject drops it. Either can be done one at a time or in bulk.
 */
export function DraftsPanel({
  projectId,
  drafts,
  platforms,
  canManage,
  onOpenRequirements,
  onExplore,
  questions,
  po,
  focusId,
}: {
  projectId: string;
  drafts: TestCaseDraftDto[];
  platforms: Platform[];
  /** Open "Explore the app"; absent when exploring is not possible here. */
  onExplore?: () => void;
  canManage: boolean;
  onOpenRequirements: () => void;
  /** Questions for the PO about these drafts. */
  questions: PoQuestionDto[];
  po: PoContext;
  /** A draft to open, from a notification. */
  focusId?: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TestCaseDraftDto | null>(null);
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [requirementFilter, setRequirementFilter] = useState<string>(ALL);
  const [moduleFilter, setModuleFilter] = useState<string>(ALL);
  const [runFilter, setRunFilter] = useState<string>(ALL);

  // The AI runs that wrote these drafts, newest first: the top one is what
  // was just generated.
  const runs = useMemo(() => {
    const byKey = new Map<string, { key: string; source: TestCaseDraftDto["source"]; count: number }>();
    for (const draft of drafts) {
      const key = runKey(draft);
      const entry = byKey.get(key) ?? { key, source: draft.source, count: 0 };
      entry.count += 1;
      byKey.set(key, entry);
    }
    return Array.from(byKey.values()).sort((a, b) => b.source.runAt.localeCompare(a.source.runAt));
  }, [drafts]);
  const activeRun = runFilter !== ALL && runs.some((run) => run.key === runFilter) ? runFilter : ALL;

  // A requirement or module whose drafts have all been reviewed is gone; its
  // filter falls back to everything rather than showing nothing.
  const activeRequirement =
    requirementFilter !== ALL && drafts.some((d) => inRequirement(d, requirementFilter))
      ? requirementFilter
      : ALL;
  const activeModule =
    moduleFilter !== ALL && drafts.some((d) => d.moduleName === moduleFilter) ? moduleFilter : ALL;

  // Each list counts the drafts the other filter leaves, so picking a
  // requirement narrows the modules to its own, and the other way round.
  const requirementOptions = useMemo(() => {
    const byId = new Map<string, { id: string; code: string; title: string; count: number }>();
    let unlinked = 0;
    let total = 0;
    for (const draft of drafts) {
      const counted = inRun(draft, activeRun) && (activeModule === ALL || draft.moduleName === activeModule) ? 1 : 0;
      total += counted;
      if (draft.requirements.length === 0) unlinked += counted;
      for (const req of draft.requirements) {
        const entry = byId.get(req.id) ?? { ...req, count: 0 };
        entry.count += counted;
        byId.set(req.id, entry);
      }
    }
    const linked = Array.from(byId.values())
      .filter((req) => req.count > 0 || req.id === activeRequirement)
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    return { linked, unlinked, total };
  }, [drafts, activeModule, activeRequirement, activeRun]);

  const moduleOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const draft of drafts) {
      const counted = inRun(draft, activeRun) && inRequirement(draft, activeRequirement) ? 1 : 0;
      total += counted;
      counts.set(draft.moduleName, (counts.get(draft.moduleName) ?? 0) + counted);
    }
    const modules = Array.from(counts.entries())
      .filter(([name, count]) => count > 0 || name === activeModule)
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    return { modules, total };
  }, [drafts, activeRequirement, activeModule, activeRun]);

  const visible = useMemo(
    () =>
      drafts.filter(
        (d) =>
          inRun(d, activeRun) &&
          inRequirement(d, activeRequirement) &&
          (activeModule === ALL || d.moduleName === activeModule),
      ),
    [drafts, activeRequirement, activeModule, activeRun],
  );
  const filtered = activeRequirement !== ALL || activeModule !== ALL || activeRun !== ALL;

  // Paged before grouping, so every page holds the same number of drafts
  // however the modules fall.
  const paging = useClientPagination(visible, `${activeRun}|${activeRequirement}|${activeModule}`);
  const shown = paging.pageItems;

  const questionsFor = useMemo(() => {
    const byDraft = new Map<string, PoQuestionDto[]>();
    for (const question of questions) {
      byDraft.set(question.draftId!, [...(byDraft.get(question.draftId!) ?? []), question]);
    }
    return (id: string) => byDraft.get(id) ?? [];
  }, [questions]);

  // Opened from a notification: clear the filters, then — once the list has
  // re-rendered — go to the draft's page, expand it and scroll to it.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [seenFocus, setSeenFocus] = useState<string | undefined>(undefined);
  if (focusId !== seenFocus) {
    setSeenFocus(focusId);
    if (focusId && drafts.some((draft) => draft.id === focusId)) {
      setRequirementFilter(ALL);
      setModuleFilter(ALL);
      setRunFilter(ALL);
      setExpanded((current) => new Set(current).add(focusId));
      setPendingFocus(focusId);
    }
  }
  useEffect(() => {
    if (!pendingFocus) return;
    const index = visible.findIndex((draft) => draft.id === pendingFocus);
    if (index === -1) return;
    paging.setPage(Math.floor(index / paging.pageSize) + 1);
    setPendingFocus(null);
    requestAnimationFrame(() =>
      document.getElementById(`draft-${pendingFocus}`)?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  }, [pendingFocus, visible, paging]);

  const groups = useMemo(() => {
    const byModule = new Map<string, TestCaseDraftDto[]>();
    for (const draft of shown) {
      byModule.set(draft.moduleName, [...(byModule.get(draft.moduleName) ?? []), draft]);
    }
    return Array.from(byModule.entries());
  }, [shown]);

  // Only what is on screen: a bulk accept never reaches drafts the filter or
  // another page hides.
  const selectedIds = shown.filter((d) => selected.has(d.id)).map((d) => d.id);
  // Drafts whose requirements the PO has not verified wait; Accept skips them.
  const acceptableIds = shown.filter((d) => selected.has(d.id) && !waitingForPo(d)).map((d) => d.id);
  const waitingSelected = selectedIds.length - acceptableIds.length;

  function toggle(set: Set<string>, ids: string[], on: boolean) {
    const next = new Set(set);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    return next;
  }

  async function review(action: "accept" | "reject", ids: string[]) {
    if (ids.length === 0) return;
    setBusy(action);
    try {
      const result = await api.post<DraftReviewResult>(
        `/api/projects/${projectId}/test-case-drafts/review`,
        { action, ids },
      );
      toast.success(
        action === "accept"
          ? `Added ${result.accepted.length} test case${result.accepted.length === 1 ? "" : "s"}`
          : `Rejected ${result.rejected} draft${result.rejected === 1 ? "" : "s"}`,
      );
      setSelected(toggle(selected, ids, false));
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  if (drafts.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nothing to review"
        description="Have the AI suggest test cases — from a PRD or FRD under Requirements, or by exploring the app's pages. What it writes waits here until you accept or reject it."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {canManage && onExplore && (
              <Button onClick={onExplore}>
                <Compass className="mr-2 size-4" />
                Explore the app
              </Button>
            )}
            <Button variant="outline" onClick={onOpenRequirements}>
              Go to requirements
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Select value={activeRun} onValueChange={setRunFilter}>
            <SelectTrigger className="w-full sm:w-72" aria-label="Filter by AI run">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All AI runs ({drafts.length})</SelectItem>
              {runs.map((run, index) => (
                <SelectItem key={run.key} value={run.key}>
                  {index === 0 && runs.length > 1 ? "Latest · " : ""}
                  {run.source.kind === "explore" ? "Explore" : "Requirements"} · {run.source.detail} ·{" "}
                  {formatRelative(run.source.runAt)} ({run.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={activeRequirement} onValueChange={setRequirementFilter}>
            <SelectTrigger className="w-full sm:w-96" aria-label="Filter by requirement">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All requirements ({requirementOptions.total})</SelectItem>
              {requirementOptions.linked.map((req) => (
                <SelectItem key={req.id} value={req.id}>
                  <span className="font-mono">{req.code}</span> — {req.title} ({req.count})
                </SelectItem>
              ))}
              {(requirementOptions.unlinked > 0 || activeRequirement === NO_REQUIREMENT) && (
                <SelectItem value={NO_REQUIREMENT}>
                  No requirement — from exploring the app ({requirementOptions.unlinked})
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <Select value={activeModule} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Filter by module">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All modules ({moduleOptions.total})</SelectItem>
              {moduleOptions.modules.map(([name, count]) => (
                <SelectItem key={name} value={name}>
                  {name} ({count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtered && (
            <Button
              variant="ghost"
              onClick={() => {
                setRequirementFilter(ALL);
                setModuleFilter(ALL);
                setRunFilter(ALL);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        {canManage && onExplore && (
          <Button variant="outline" size="sm" onClick={onExplore}>
            <Compass className="mr-2 size-4" />
            Explore the app
          </Button>
        )}
      </div>
      {canManage && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 px-4 py-2 backdrop-blur">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={shown.length > 0 && selectedIds.length === shown.length}
              onCheckedChange={(checked) =>
                setSelected(toggle(selected, shown.map((d) => d.id), checked === true))
              }
            />
            {selectedIds.length > 0
              ? `${selectedIds.length} of ${shown.length} selected`
              : paging.totalPages > 1
                ? `Select all ${shown.length} on this page`
                : `Select all ${shown.length}`}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {waitingSelected > 0 && (
              <span className="text-xs text-status-blocked">
                {waitingSelected} waiting for the PO to verify {waitingSelected === 1 ? "its requirement" : "their requirements"}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={selectedIds.length === 0 || busy !== null}
              onClick={() => void review("reject", selectedIds)}
            >
              {busy === "reject" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <X className="mr-2 size-4" />}
              Reject
            </Button>
            <Button
              size="sm"
              disabled={acceptableIds.length === 0 || busy !== null}
              onClick={() => void review("accept", acceptableIds)}
            >
              {busy === "accept" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}
              Accept as test cases
              {waitingSelected > 0 && acceptableIds.length > 0 && ` (${acceptableIds.length})`}
            </Button>
          </div>
        </div>
      )}

      {visible.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No drafts match these filters.
          </CardContent>
        </Card>
      )}

      {groups.map(([moduleName, moduleDrafts]) => (
        <Card key={moduleName}>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0 px-4 py-3">
            {canManage && (
              <Checkbox
                aria-label={`Select all in ${moduleName}`}
                checked={moduleDrafts.every((d) => selected.has(d.id))}
                onCheckedChange={(checked) =>
                  setSelected(toggle(selected, moduleDrafts.map((d) => d.id), checked === true))
                }
              />
            )}
            <CardTitle className="text-base">{moduleName}</CardTitle>
            <span className="text-sm text-muted-foreground">{moduleDrafts.length}</span>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {moduleDrafts.map((draft) => {
              const open = expanded.has(draft.id);
              return (
                <div key={draft.id} id={`draft-${draft.id}`} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    {canManage && (
                      <Checkbox
                        className="mt-1"
                        aria-label={`Select ${draft.title}`}
                        checked={selected.has(draft.id)}
                        onCheckedChange={(checked) =>
                          setSelected(toggle(selected, [draft.id], checked === true))
                        }
                      />
                    )}
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-start gap-1.5 text-left"
                      onClick={() => setExpanded(toggle(expanded, [draft.id], !open))}
                    >
                      {open ? (
                        <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="space-y-1">
                        <span className="block font-medium">{draft.title}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {draft.subModule && (
                            <Badge variant="secondary" title="Sub-module">
                              {draft.subModule}
                            </Badge>
                          )}
                          <TestTypeBadge testType={draft.testType} />
                          <PriorityBadge priority={draft.priority} />
                          <DraftSource draft={draft} />
                          {draft.openQuestions && (
                            <span className="inline-flex items-center gap-1 text-xs text-status-blocked">
                              <CircleHelp className="size-3.5" aria-hidden />
                              {questionCount(draft.openQuestions)} open question
                              {questionCount(draft.openQuestions) === 1 ? "" : "s"}
                            </span>
                          )}
                          <PoQuestionBadge questions={questionsFor(draft.id)} />
                          {draft.requirements.map((req) => (
                            <Badge
                              key={req.id}
                              variant="outline"
                              className={cn("font-mono", !req.verified && "border-status-blocked/50 text-status-blocked")}
                              title={req.verified ? req.title : `${req.title} — not verified by the PO yet`}
                            >
                              {req.code}
                            </Badge>
                          ))}
                          {waitingForPo(draft) && (
                            <span className="text-xs font-medium text-status-blocked">Waiting for PO</span>
                          )}
                        </span>
                      </span>
                    </button>
                    {canManage && (
                      <div className="flex shrink-0 gap-1">
                        <Button size="icon" variant="ghost" aria-label="Edit draft" onClick={() => setEditing(draft)}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Reject draft"
                          disabled={busy !== null}
                          onClick={() => void review("reject", [draft.id])}
                        >
                          <X className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Accept draft"
                          title={waitingForPo(draft) ? "Waiting for the PO to verify its requirement" : undefined}
                          className="text-status-passed"
                          disabled={busy !== null || waitingForPo(draft)}
                          onClick={() => void review("accept", [draft.id])}
                        >
                          <Check className="size-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  {open && (
                    <div className="mt-3 grid gap-3 pl-7 text-sm md:grid-cols-3">
                      <DraftField label="Preconditions" text={draft.preconditions} />
                      <DraftField label="Steps" text={draft.steps} />
                      <DraftField label="Expected result" text={draft.expectedResult} />
                    </div>
                  )}
                  {open && (
                    <DraftQuestions
                      draft={draft}
                      projectId={projectId}
                      questions={questionsFor(draft.id)}
                      po={po}
                    />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <PaginationControls
        page={paging.page}
        pageSize={paging.pageSize}
        total={paging.total}
        totalPages={paging.totalPages}
        onPageChange={paging.setPage}
        onPageSizeChange={paging.setPageSize}
      />

      <DraftEditDialog
        draft={editing}
        platforms={platforms}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

const ALL = "__all";
const NO_REQUIREMENT = "__none";

/** The draft came from this run, or `ALL` for any. */
function inRun(draft: TestCaseDraftDto, filter: string): boolean {
  return filter === ALL || runKey(draft) === filter;
}

/** The run that wrote it; drafts whose run is gone group by kind. */
function runKey(draft: TestCaseDraftDto): string {
  return draft.source.runId ?? `gone:${draft.source.kind}`;
}

/** Where the draft came from: a document's requirements, or explored pages. */
function DraftSource({ draft }: { draft: TestCaseDraftDto }) {
  const explore = draft.source.kind === "explore";
  const Icon = explore ? Compass : FileText;
  return (
    <span
      className="inline-flex max-w-64 items-center gap-1 text-xs text-muted-foreground"
      title={`${explore ? "Explored" : "Generated from"} ${draft.source.detail} · ${formatRelative(draft.source.runAt)}`}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        {explore ? "Explore" : "From"} {draft.source.detail}
      </span>
    </span>
  );
}

/** A requirement it is for is not verified by the PO yet, so it cannot be accepted. */
function waitingForPo(draft: TestCaseDraftDto): boolean {
  return draft.requirements.some((req) => !req.verified);
}

/** The draft came from this requirement — or from none, or `ALL` for any. */
function inRequirement(draft: TestCaseDraftDto, filter: string): boolean {
  if (filter === ALL) return true;
  if (filter === NO_REQUIREMENT) return draft.requirements.length === 0;
  return draft.requirements.some((req) => req.id === filter);
}

/**
 * A draft's open questions, with "Ask the PO" beside them, and what has
 * been asked and answered about it so far.
 */
function DraftQuestions({
  draft,
  projectId,
  questions,
  po,
}: {
  draft: TestCaseDraftDto;
  projectId: string;
  questions: PoQuestionDto[];
  po: PoContext;
}) {
  const ask = po.canAsk ? (
    <AskPoDialog
      ask={{ url: `/api/projects/${projectId}/po-questions`, extra: { draftId: draft.id } }}
      where="under this draft, and moves to the test case's discussion when the draft is accepted"
      label={questions.length ? "New question" : undefined}
      admins={po.admins}
      currentUserId={po.currentUserId}
      openQuestions={draft.openQuestions}
    />
  ) : null;
  return (
    <div className="ml-7 mt-3 space-y-2">
      {draft.openQuestions ? (
        <OpenQuestions text={draft.openQuestions} action={ask} forPo={po.canAnswer} />
      ) : (
        ask
      )}
      <PoQuestions questions={questions} po={po} openQuestions={draft.openQuestions} />
    </div>
  );
}

const questionCount = (text: string) => text.split("\n").filter((line) => line.trim()).length;

function DraftField({ label, text }: { label: string; text: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap">{text || "—"}</p>
    </div>
  );
}

function DraftEditDialog({
  draft,
  platforms,
  onClose,
}: {
  draft: TestCaseDraftDto | null;
  platforms: Platform[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<TestCaseDraftInput | null>(null);
  const [openFor, setOpenFor] = useState<TestCaseDraftDto | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the form whenever a different draft is opened.
  if (draft !== openFor) {
    setOpenFor(draft);
    setForm(
      draft && {
        moduleName: draft.moduleName,
        subModule: draft.subModule ?? "",
        title: draft.title,
        preconditions: draft.preconditions ?? "",
        steps: draft.steps ?? "",
        expectedResult: draft.expectedResult ?? "",
        openQuestions: draft.openQuestions ?? "",
        testType: draft.testType,
        priority: draft.priority,
        platform: draft.platform,
      },
    );
  }

  const text = (
    key: "moduleName" | "subModule" | "title" | "preconditions" | "steps" | "expectedResult" | "openQuestions",
  ) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => current && { ...current, [key]: event.target.value });

  async function handleSave() {
    if (!draft || !form) return;
    setSaving(true);
    try {
      await api.patch(`/api/test-case-drafts/${draft.id}`, form);
      toast.success("Draft updated");
      onClose();
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit draft</DialogTitle>
          <DialogDescription>Changes are kept on the draft until you accept it.</DialogDescription>
        </DialogHeader>
        {form && (
          <div className="-m-1 grid max-h-[65vh] gap-4 overflow-y-auto p-1">
            <div className="grid gap-4 sm:grid-cols-[160px_160px_1fr]">
              <div className="space-y-2">
                <Label htmlFor="draft-module">Module</Label>
                <Input id="draft-module" value={form.moduleName} onChange={text("moduleName")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="draft-sub-module">Sub-module</Label>
                <Input
                  id="draft-sub-module"
                  placeholder="Optional"
                  value={form.subModule ?? ""}
                  onChange={text("subModule")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="draft-title">Title</Label>
                <Input id="draft-title" value={form.title} onChange={text("title")} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Test type</Label>
                <Select
                  value={form.testType}
                  onValueChange={(value) => setForm({ ...form, testType: value as typeof form.testType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEST_TYPES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {TEST_TYPE_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(value) => setForm({ ...form, priority: value as typeof form.priority })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {PRIORITY_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Platform</Label>
                <Select
                  value={form.platform}
                  onValueChange={(value) => setForm({ ...form, platform: value as typeof form.platform })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.filter(
                      (option) => platforms.includes(option) || option === form.platform,
                    ).map((option) => (
                      <SelectItem key={option} value={option}>
                        {PLATFORM_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-pre">Preconditions</Label>
              <Textarea id="draft-pre" rows={2} value={form.preconditions ?? ""} onChange={text("preconditions")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-steps">Steps</Label>
              <Textarea id="draft-steps" rows={6} value={form.steps ?? ""} onChange={text("steps")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-expected">Expected result</Label>
              <Textarea id="draft-expected" rows={3} value={form.expectedResult ?? ""} onChange={text("expectedResult")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="draft-questions">Open questions for the PO</Label>
              <Textarea
                id="draft-questions"
                rows={3}
                placeholder="- What exactly should the error message say?"
                value={form.openQuestions ?? ""}
                onChange={text("openQuestions")}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void handleSave()}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
