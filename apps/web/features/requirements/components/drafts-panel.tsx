"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
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
  TestCaseDraftDto,
  TestCaseDraftInput,
} from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";
import { useClientPagination } from "@/hooks/use-client-pagination";

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
}: {
  projectId: string;
  drafts: TestCaseDraftDto[];
  platforms: Platform[];
  /** Open "Explore the app"; absent when exploring is not possible here. */
  onExplore?: () => void;
  canManage: boolean;
  onOpenRequirements: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TestCaseDraftDto | null>(null);
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [requirementFilter, setRequirementFilter] = useState<string>(ALL);
  const [moduleFilter, setModuleFilter] = useState<string>(ALL);

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
      const counted = activeModule === ALL || draft.moduleName === activeModule ? 1 : 0;
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
  }, [drafts, activeModule, activeRequirement]);

  const moduleOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    for (const draft of drafts) {
      const counted = inRequirement(draft, activeRequirement) ? 1 : 0;
      total += counted;
      counts.set(draft.moduleName, (counts.get(draft.moduleName) ?? 0) + counted);
    }
    const modules = Array.from(counts.entries())
      .filter(([name, count]) => count > 0 || name === activeModule)
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    return { modules, total };
  }, [drafts, activeRequirement, activeModule]);

  const visible = useMemo(
    () =>
      drafts.filter(
        (d) =>
          inRequirement(d, activeRequirement) &&
          (activeModule === ALL || d.moduleName === activeModule),
      ),
    [drafts, activeRequirement, activeModule],
  );
  const filtered = activeRequirement !== ALL || activeModule !== ALL;

  // Paged before grouping, so every page holds the same number of drafts
  // however the modules fall.
  const paging = useClientPagination(visible, `${activeRequirement}|${activeModule}`);
  const shown = paging.pageItems;

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
          <div className="flex gap-2">
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
              disabled={selectedIds.length === 0 || busy !== null}
              onClick={() => void review("accept", selectedIds)}
            >
              {busy === "accept" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}
              Accept as test cases
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
                <div key={draft.id} className="px-4 py-3">
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
                          {draft.requirements.map((req) => (
                            <Badge key={req.id} variant="outline" className="font-mono" title={req.title}>
                              {req.code}
                            </Badge>
                          ))}
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
                          className="text-status-passed"
                          disabled={busy !== null}
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

/** The draft came from this requirement — or from none, or `ALL` for any. */
function inRequirement(draft: TestCaseDraftDto, filter: string): boolean {
  if (filter === ALL) return true;
  if (filter === NO_REQUIREMENT) return draft.requirements.length === 0;
  return draft.requirements.some((req) => req.id === filter);
}

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
        testType: draft.testType,
        priority: draft.priority,
        platform: draft.platform,
      },
    );
  }

  const text = (key: "moduleName" | "subModule" | "title" | "preconditions" | "steps" | "expectedResult") =>
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
