"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  SCROLL_BOX,
  STICKY_HEADER,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PaginationControls } from "@/components/shared/pagination-controls";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { EXECUTION_STATUS_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useClientPagination } from "@/hooks/use-client-pagination";
import {
  AI_MODELS,
  AI_MODEL_LABELS,
  type AiJobDto,
  type AiModel,
  type GenerationDepth,
  type Platform,
  type PoQuestionDto,
  type RequirementDocDto,
  type RequirementDto,
} from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";
import { formatDateTime } from "@/utils/format";
import { OPEN_QUESTIONS_FOR_PO, OPEN_QUESTIONS_FOR_QA } from "@/components/shared/open-questions";

import {
  ChangeBadge,
  ChangeDetail,
  ChangeReview,
  ChangesBanner,
  needsAttention,
} from "./requirement-changes";
import { AskPoDialog } from "@/features/comments/components/ask-po-dialog";
import { PoQuestionBadge, PoQuestions, type PoContext } from "./po-questions";
import type { StartAi } from "./requirements-workspace";

type Coverage = "all" | "unverified" | "uncovered" | "covered" | "questions" | "changes" | "removed";

/** A document's section — the unit a feature is usually written as. */
type Group = { key: string; section: string | null; docTitle: string; items: RequirementDto[] };

const groupKey = (req: RequirementDto) => `${req.docId}\u0000${req.section ?? ""}`;

/** Past this many, sections start collapsed so the page opens as an overview. */
const COLLAPSE_FROM = 40;

export function RequirementsPanel({
  projectId,
  docs,
  requirements,
  platforms,
  canManage,
  canVerify = false,
  generating,
  startAi,
  onOpenDocuments,
  questions,
  po,
  focusId,
}: {
  projectId: string;
  docs: RequirementDocDto[];
  requirements: RequirementDto[];
  platforms: Platform[];
  canManage: boolean;
  /** An admin — the PO — who confirms requirements are right. */
  canVerify?: boolean;
  generating: boolean;
  startAi: StartAi;
  onOpenDocuments: () => void;
  /** Questions for the PO about these requirements. */
  questions: PoQuestionDto[];
  po: PoContext;
  /** A requirement to open, from a notification. */
  focusId?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  // "all", a document's id, or "folder:<name>" for a feature's documents.
  const [docFilter, setDocFilter] = useState("all");
  const folderOf = useMemo(() => new Map(docs.map((doc) => [doc.id, doc.folder])), [docs]);
  const folders = useMemo(
    () => [...new Set(docs.map((doc) => doc.folder).filter((f): f is string => Boolean(f)))].sort((a, b) => a.localeCompare(b)),
    [docs],
  );
  const [coverage, setCoverage] = useState<Coverage>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [generateOpen, setGenerateOpen] = useState(false);
  const [editing, setEditing] = useState<RequirementDto | "new" | null>(null);
  const [deleting, setDeleting] = useState<RequirementDto | null>(null);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return requirements.filter((req) => {
      // Removed requirements only show when asked for.
      if ((coverage === "removed") !== (req.status === "REMOVED")) return false;
      if (coverage === "changes" && !needsAttention(req)) return false;
      if (docFilter.startsWith("folder:")) {
        if (folderOf.get(req.docId) !== docFilter.slice("folder:".length)) return false;
      } else if (docFilter !== "all" && req.docId !== docFilter) return false;
      if (coverage === "uncovered" && req.testCases.length > 0) return false;
      if (coverage === "covered" && req.testCases.length === 0) return false;
      if (coverage === "questions" && !req.openQuestions) return false;
      if (coverage === "unverified" && req.verifiedAt) return false;
      if (!term) return true;
      return [req.code, req.title, req.description, req.section]
        .filter(Boolean)
        .some((text) => text!.toLowerCase().includes(term));
    });
  }, [requirements, search, docFilter, coverage, folderOf]);

  const paging = useClientPagination(visible, `${search}|${docFilter}|${coverage}`);

  // Always paged. With more than one section, a page's rows are grouped under
  // their sections (counts and progress still cover the whole section).
  const groupsOf = (items: RequirementDto[]) => {
    const byKey = new Map<string, Group>();
    for (const req of items) {
      const key = groupKey(req);
      let group = byKey.get(key);
      if (!group) {
        group = { key, section: req.section, docTitle: req.docTitle, items: [] };
        byKey.set(key, group);
      }
      group.items.push(req);
    }
    return [...byKey.values()];
  };
  const allGroups = useMemo(() => groupsOf(visible), [visible]);
  const groups = useMemo(() => groupsOf(paging.pageItems), [paging.pageItems]);
  const grouped = allGroups.length > 1;

  // Each section's progress counts all its requirements, whatever the filter.
  const progress = useMemo(() => {
    const byKey = new Map<
      string,
      { total: number; covered: number; questions: number; unverified: string[] }
    >();
    for (const req of requirements) {
      if (req.status === "REMOVED") continue;
      const key = groupKey(req);
      const counts = byKey.get(key) ?? { total: 0, covered: 0, questions: 0, unverified: [] };
      counts.total += 1;
      if (req.testCases.length > 0) counts.covered += 1;
      if (req.openQuestions) counts.questions += 1;
      if (!req.verifiedAt) counts.unverified.push(req.id);
      byKey.set(key, counts);
    }
    return byKey;
  }, [requirements]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    requirements.length > COLLAPSE_FROM ? new Set(requirements.map(groupKey)) : new Set(),
  );
  // A search shows every match, collapsed section or not.
  const searching = search.trim() !== "";
  const isOpen = (key: string) => searching || !collapsed.has(key);
  const allCollapsed = allGroups.every((group) => collapsed.has(group.key));

  const questionsFor = useMemo(() => {
    const byRequirement = new Map<string, PoQuestionDto[]>();
    for (const question of questions) {
      const id = question.requirementId!;
      byRequirement.set(id, [...(byRequirement.get(id) ?? []), question]);
    }
    return (id: string) => byRequirement.get(id) ?? [];
  }, [questions]);

  // Opened from a notification: clear the filters that could hide the
  // requirement, then — once the list has re-rendered — go to its page,
  // expand it and scroll to it.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [seenFocus, setSeenFocus] = useState<string | undefined>(undefined);
  if (focusId !== seenFocus) {
    setSeenFocus(focusId);
    const target = focusId ? requirements.find((req) => req.id === focusId) : undefined;
    if (target) {
      setSearch("");
      setDocFilter("all");
      setCoverage(target.status === "REMOVED" ? "removed" : "all");
      setExpanded((current) => new Set(current).add(target.id));
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(groupKey(target));
        return next;
      });
      setPendingFocus(target.id);
    }
  }
  useEffect(() => {
    if (!pendingFocus) return;
    const index = visible.findIndex((req) => req.id === pendingFocus);
    if (index === -1) return;
    paging.setPage(Math.floor(index / paging.pageSize) + 1);
    setPendingFocus(null);
    requestAnimationFrame(() =>
      document.getElementById(`requirement-${pendingFocus}`)?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  }, [pendingFocus, visible, paging]);
  const shown = grouped
    ? groups.flatMap((group) => (isOpen(group.key) ? group.items : []))
    : paging.pageItems;

  // Selection survives filtering, so it is counted against what still exists.
  const selectedIds = requirements
    .filter((req) => selected.has(req.id))
    .map((req) => req.id);
  const allShownSelected =
    shown.length > 0 && shown.every((req) => selected.has(req.id));

  function toggle(set: Set<string>, id: string, on: boolean) {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  }

  const [verifying, setVerifying] = useState(false);
  async function verify(ids: string[], verified = true) {
    if (ids.length === 0) return;
    setVerifying(true);
    try {
      const { updated } = await api.post<{ updated: number }>(`/api/projects/${projectId}/requirements/verify`, {
        ids,
        verified,
      });
      toast.success(
        verified
          ? `Verified ${updated} requirement${updated === 1 ? "" : "s"} — their drafts can be accepted`
          : "Marked not verified",
      );
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setVerifying(false);
    }
  }
  const selectedUnverified = requirements
    .filter((req) => selected.has(req.id) && req.status === "ACTIVE" && !req.verifiedAt)
    .map((req) => req.id);

  async function restore(req: RequirementDto) {
    try {
      await api.post(`/api/requirements/${req.id}/review`, { action: "restore" });
      toast.success(`${req.code} restored`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await api.delete(`/api/requirements/${deleting.id}`);
      toast.success(`Deleted ${deleting.code}`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  if (requirements.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No requirements yet"
        description="Add a PRD or FRD in Documents and the AI reads it into requirements here. You can also add requirements by hand."
        action={
          <div className="flex gap-2">
            <Button onClick={onOpenDocuments}>Go to documents</Button>
            {canManage && docs.length > 0 && (
              <Button variant="outline" onClick={() => setEditing("new")}>
                <Plus className="mr-2 size-4" />
                Add requirement
              </Button>
            )}
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <Input
            className="w-full sm:w-64"
            placeholder="Search code, title, section…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {docs.length > 1 && (
            <Select value={docFilter} onValueChange={setDocFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All documents</SelectItem>
                {folders.map((folder) => (
                  <SelectItem key={`folder:${folder}`} value={`folder:${folder}`}>
                    Folder: {folder}
                  </SelectItem>
                ))}
                {docs.map((doc) => (
                  <SelectItem key={doc.id} value={doc.id}>
                    {doc.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={coverage} onValueChange={(value) => setCoverage(value as Coverage)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All requirements</SelectItem>
              <SelectItem value="uncovered">Not covered</SelectItem>
              <SelectItem value="covered">Covered</SelectItem>
              <SelectItem value="questions">With open questions</SelectItem>
              <SelectItem value="changes">Changed in new version</SelectItem>
              <SelectItem value="unverified">Not verified by the PO</SelectItem>
              <SelectItem value="removed">Removed</SelectItem>
            </SelectContent>
          </Select>
          {grouped && !searching && (
            <Button
              variant="ghost"
              onClick={() =>
                setCollapsed(allCollapsed ? new Set() : new Set(allGroups.map((group) => group.key)))
              }
            >
              {allCollapsed ? "Expand all" : "Collapse all"}
            </Button>
          )}
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            {canVerify && (
              <Button
                variant="outline"
                disabled={selectedUnverified.length === 0 || verifying}
                onClick={() => void verify(selectedUnverified)}
                title="Confirm the selected requirements are right"
              >
                {verifying ? <Loader2 className="mr-2 size-4 animate-spin" /> : <BadgeCheck className="mr-2 size-4" />}
                Verify
                {selectedUnverified.length > 0 && ` (${selectedUnverified.length})`}
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing("new")}>
              <Plus className="mr-2 size-4" />
              Add
            </Button>
            <Button
              disabled={selectedIds.length === 0 || generating}
              onClick={() => setGenerateOpen(true)}
            >
              {generating ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 size-4" />
              )}
              Draft test cases
              {selectedIds.length > 0 && ` (${selectedIds.length})`}
            </Button>
          </div>
        )}
      </div>

      {coverage !== "changes" && (
        <ChangesBanner requirements={requirements} onReview={() => setCoverage("changes")} />
      )}

      <Card className="overflow-hidden">
        <Table containerClassName={SCROLL_BOX}>
          <TableHeader className={cn(STICKY_HEADER, "bg-card")}>
            <TableRow>
              {canManage && (
                <TableHead className="w-12 pl-4">
                  <Checkbox
                    aria-label="Select all shown"
                    checked={allShownSelected}
                    onCheckedChange={(checked) => {
                      const next = new Set(selected);
                      for (const req of shown) {
                        if (checked) next.add(req.id);
                        else next.delete(req.id);
                      }
                      setSelected(next);
                    }}
                  />
                </TableHead>
              )}
              <TableHead className={grouped ? "w-14" : "w-8"} />
              <TableHead className="w-[120px]">Code</TableHead>
              <TableHead>Requirement</TableHead>
              <TableHead className="w-[220px]">Test cases</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  No requirements match these filters.
                </TableCell>
              </TableRow>
            )}
            {(grouped ? groups : [{ key: "", section: null, docTitle: "", items: shown }]).map((group) => {
              const groupOpen = !grouped || isOpen(group.key);
              const counts = progress.get(group.key);
              const label = group.section ?? "No section";
              return (
                <Fragment key={group.key}>
                  {grouped && (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      {canManage && (
                        <TableCell className="pl-4">
                          <Checkbox
                            aria-label={`Select all in ${label}`}
                            checked={group.items.every((req) => selected.has(req.id))}
                            onCheckedChange={(checked) => {
                              const next = new Set(selected);
                              for (const req of group.items) {
                                if (checked) next.add(req.id);
                                else next.delete(req.id);
                              }
                              setSelected(next);
                            }}
                          />
                        </TableCell>
                      )}
                      <TableCell colSpan={canManage ? 5 : 4} className="py-1.5 pl-1">
                        <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-left"
                          aria-expanded={groupOpen}
                          disabled={searching}
                          onClick={() => setCollapsed(toggle(collapsed, group.key, groupOpen))}
                        >
                          <span className="flex size-7 items-center justify-center">
                            {groupOpen ? (
                              <ChevronDown className="size-4 text-foreground" strokeWidth={2.5} />
                            ) : (
                              <ChevronRight className="size-4 text-foreground" strokeWidth={2.5} />
                            )}
                          </span>
                          <span className={cn("font-medium", !group.section && "text-muted-foreground")}>
                            {label}
                          </span>
                          {docs.length > 1 && docFilter === "all" && (
                            <span className="text-xs text-muted-foreground">{group.docTitle}</span>
                          )}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {counts && counts.total > 0 && (
                              <span className={cn(counts.covered === counts.total && "font-medium text-status-passed")}>
                                {counts.covered}/{counts.total} covered
                              </span>
                            )}
                            {counts && counts.questions > 0 && (
                              <span className="text-status-blocked">
                                {" · "}
                                {counts.questions} with questions
                              </span>
                            )}
                            {counts && counts.unverified.length > 0 && (
                              <span className="text-status-blocked">
                                {" · "}
                                {counts.unverified.length} not verified
                              </span>
                            )}
                            {(coverage !== "all" || docFilter !== "all") && ` · ${group.items.length} shown`}
                          </span>
                        </button>
                        {canVerify && counts && counts.unverified.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0"
                            disabled={verifying}
                            onClick={() => void verify(counts.unverified)}
                          >
                            <BadgeCheck className="mr-1.5 size-3.5" />
                            Verify section
                          </Button>
                        )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                {groupOpen && group.items.map((req) => {
                  const open = expanded.has(req.id);
                  return (
                    <Fragment key={req.id}>
                      <TableRow
                        id={`requirement-${req.id}`}
                        data-state={selected.has(req.id) ? "selected" : undefined}
                      >
                        {canManage && (
                          <TableCell className="pl-4">
                            <Checkbox
                              aria-label={`Select ${req.code}`}
                              checked={selected.has(req.id)}
                              onCheckedChange={(checked) =>
                                setSelected(toggle(selected, req.id, checked === true))
                              }
                            />
                          </TableCell>
                        )}
                        {/* Under a section, a requirement's arrow sits one step in
                            and lighter, so it reads as inside the section's. */}
                        <TableCell className={cn("px-1", grouped && "pl-7")}>
                          <Button
                            size="icon"
                            variant="ghost"
                            className={cn("size-7", grouped && "size-6 text-muted-foreground")}
                            aria-label={open ? "Hide details" : "Show details"}
                            onClick={() => setExpanded(toggle(expanded, req.id, !open))}
                          >
                            {open ? (
                              <ChevronDown className={grouped ? "size-3.5" : "size-4"} />
                            ) : (
                              <ChevronRight className={grouped ? "size-3.5" : "size-4"} />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{req.code}</TableCell>
                        <TableCell>
                          <div className="flex items-start gap-2">
                            <span
                              className={cn(
                                "font-medium",
                                req.status === "REMOVED" && "text-muted-foreground line-through",
                              )}
                            >
                              {req.title}
                            </span>
                            <ChangeBadge requirement={req} />
                            {req.status === "ACTIVE" && <VerifiedMark requirement={req} />}
                            {req.openQuestions && (
                              <CircleHelp
                                className="mt-0.5 size-4 shrink-0 text-status-blocked"
                                aria-label="Has open questions"
                              />
                            )}
                            <PoQuestionBadge questions={questionsFor(req.id)} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {/* Under a section heading, both are already said. */}
                        {(grouped ? [] : [req.section, docs.length > 1 ? req.docTitle : null])
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          {canManage && <ChangeReview requirement={req} />}
                        </TableCell>
                        <TableCell>
                          <CoverageCell projectId={projectId} requirement={req} />
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost" aria-label="Requirement actions">
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {canVerify && req.status === "ACTIVE" && (
                                  <DropdownMenuItem onSelect={() => void verify([req.id], !req.verifiedAt)}>
                                    <BadgeCheck className="mr-2 size-4" />
                                    {req.verifiedAt ? "Mark not verified" : "Verify"}
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onSelect={() => setEditing(req)}>
                                  <Pencil className="mr-2 size-4" />
                                  Edit
                                </DropdownMenuItem>
                                {req.status === "REMOVED" && (
                                  <DropdownMenuItem onSelect={() => void restore(req)}>
                                    <RotateCcw className="mr-2 size-4" />
                                    Restore
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => setDeleting(req)}
                                >
                                  <Trash2 className="mr-2 size-4" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                      {open && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={canManage ? 6 : 4} className={cn("space-y-3 py-4 text-sm", grouped ? "pl-20" : "pl-14")}>
                            <ChangeDetail requirement={req} />
                            <Detail label="Description" text={req.description} />
                            <Detail label="Acceptance criteria" text={req.acceptanceCriteria} />
                            <Detail
                              label={po.canAnswer ? OPEN_QUESTIONS_FOR_PO : OPEN_QUESTIONS_FOR_QA}
                              text={req.openQuestions}
                              className="text-status-blocked"
                            />
                            <PoQuestions questions={questionsFor(req.id)} po={po} />
                            {po.canAsk && (
                              <AskPoDialog
                                ask={{ url: `/api/projects/${projectId}/po-questions`, extra: { requirementId: req.id } }}
                                where="under this requirement"
                                label={questionsFor(req.id).length ? "New question" : undefined}
                                admins={po.admins}
                                currentUserId={po.currentUserId}
                                openQuestions={req.openQuestions}
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {visible.length > 0 && (
        <PaginationControls
          page={paging.page}
          pageSize={paging.pageSize}
          total={paging.total}
          totalPages={paging.totalPages}
          onPageChange={paging.setPage}
          onPageSizeChange={paging.setPageSize}
        />
      )}

      <GenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        count={selectedIds.length}
        platforms={platforms}
        fromApiSpec={
          selectedIds.length > 0 &&
          selectedIds.every((id) => {
            const docId = requirements.find((req) => req.id === id)?.docId;
            return docs.some((doc) => doc.id === docId && doc.isApiSpec);
          })
        }
        onGenerate={async (options) => {
          const started = await startAi(() =>
            api.post<AiJobDto>(`/api/projects/${projectId}/test-case-drafts/generate`, {
              requirementIds: selectedIds,
              ...options,
            }),
          );
          if (started) {
            setGenerateOpen(false);
            setSelected(new Set());
          }
        }}
      />

      <RequirementFormDialog
        projectId={projectId}
        docs={docs}
        requirement={editing}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.code ?? ""}?`}
        description="Its links to test cases are removed. The test cases themselves stay."
        onConfirm={handleDelete}
      />
    </div>
  );
}

function CoverageCell({
  projectId,
  requirement,
}: {
  projectId: string;
  requirement: RequirementDto;
}) {
  if (requirement.testCases.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {requirement.pendingDraftCount > 0
          ? `${requirement.pendingDraftCount} draft${requirement.pendingDraftCount === 1 ? "" : "s"} to review`
          : "Not covered"}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {requirement.testCases.slice(0, 4).map((testCase) => (
        <Link
          key={testCase.id}
          href={`/projects/${projectId}/test-cases/${testCase.id}`}
          title={EXECUTION_STATUS_LABELS[testCase.status]}
        >
          <StatusBadge
            status={testCase.status}
            label={testCase.tcId}
            showIcon={false}
            className="font-mono"
          />
        </Link>
      ))}
      {requirement.testCases.length > 4 && (
        <span className="text-xs text-muted-foreground">
          +{requirement.testCases.length - 4}
        </span>
      )}
    </div>
  );
}

function Detail({
  label,
  text,
  className,
}: {
  label: string;
  text: string | null;
  className?: string;
}) {
  if (!text) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("whitespace-pre-wrap", className)}>{text}</p>
    </div>
  );
}

function GenerateDialog({
  open,
  onOpenChange,
  count,
  platforms,
  fromApiSpec,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  platforms: Platform[];
  /** Every selected requirement comes from an API spec or Postman collection. */
  fromApiSpec: boolean;
  onGenerate: (options: {
    platform: Platform;
    depth: GenerationDepth;
    model: AiModel;
    instructions: string;
  }) => Promise<void>;
}) {
  const suggested: Platform =
    fromApiSpec && platforms.includes("API") ? "API" : (platforms[0] ?? "WEB");
  const [platform, setPlatform] = useState<Platform>(suggested);
  // Suggested afresh each time the dialog opens, for that selection.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPlatform(suggested);
  }
  const [depth, setDepth] = useState<GenerationDepth>("essential");
  const [model, setModel] = useState<AiModel>("sonnet");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Draft test cases</DialogTitle>
          <DialogDescription>
            The AI writes black-box test cases for {count} requirement
            {count === 1 ? "" : "s"}. They wait in Review drafts until you
            accept them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Platform</Label>
              <Select value={platform} onValueChange={(value) => setPlatform(value as Platform)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {platforms.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PLATFORM_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {suggested === "API" && platform === "API" && (
                <p className="text-xs text-muted-foreground">
                  These requirements come from an API spec.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>How many cases</Label>
              <Select value={depth} onValueChange={(value) => setDepth(value as GenerationDepth)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                {/* Short labels: the list is no wider than its field, and the
                    hint below says the rest. */}
                <SelectContent className="max-w-[var(--radix-select-trigger-width)]">
                  <SelectItem value="essential">Main checks · 1–3 cases</SelectItem>
                  <SelectItem value="thorough">Full coverage · 3–8 cases</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {depth === "essential"
                  ? "Per requirement: the main success path and the most important error. Best for most requirements."
                  : "Per requirement: adds wrong input, limits, roles and status changes. For risky ones: payments, permissions, security, complex forms."}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label>AI model</Label>
            <Select value={model} onValueChange={(value) => setModel(value as AiModel)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_MODELS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {AI_MODEL_LABELS[option].label} — {AI_MODEL_LABELS[option].hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="generate-instructions">Extra instructions (optional)</Label>
            <Textarea
              id="generate-instructions"
              rows={3}
              placeholder="e.g. Test accounts are qa1@test.com / qa2@test.com. Focus on validation messages."
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || count === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await onGenerate({ platform, depth, model, instructions });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
            Start drafting
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EMPTY_FORM = {
  docId: "",
  code: "",
  title: "",
  section: "",
  description: "",
  acceptanceCriteria: "",
  openQuestions: "",
};

function RequirementFormDialog({
  projectId,
  docs,
  requirement,
  onClose,
}: {
  projectId: string;
  docs: RequirementDocDto[];
  requirement: RequirementDto | "new" | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [openFor, setOpenFor] = useState<RequirementDto | "new" | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the form whenever a different requirement is opened.
  if (requirement !== openFor) {
    setOpenFor(requirement);
    if (requirement === "new") {
      setForm({ ...EMPTY_FORM, docId: docs[0]?.id ?? "" });
    } else if (requirement) {
      setForm({
        docId: requirement.docId,
        code: requirement.code,
        title: requirement.title,
        section: requirement.section ?? "",
        description: requirement.description ?? "",
        acceptanceCriteria: requirement.acceptanceCriteria ?? "",
        openQuestions: requirement.openQuestions ?? "",
      });
    }
  }

  const set = (key: keyof typeof EMPTY_FORM) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  async function handleSave() {
    setSaving(true);
    try {
      if (requirement === "new") {
        await api.post(`/api/projects/${projectId}/requirements`, form);
        toast.success("Requirement added");
      } else if (requirement) {
        const { docId: _docId, ...body } = form;
        await api.patch(`/api/requirements/${requirement.id}`, body);
        toast.success("Requirement updated");
      }
      onClose();
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={requirement !== null} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{requirement === "new" ? "Add requirement" : "Edit requirement"}</DialogTitle>
          <DialogDescription>
            Reading the document again updates requirements from its text, so
            edits made here may be replaced then.
          </DialogDescription>
        </DialogHeader>

        <div className="-m-1 grid max-h-[65vh] gap-4 overflow-y-auto p-1">
          {requirement === "new" && (
            <div className="space-y-2">
              <Label>Document</Label>
              <Select
                value={form.docId}
                onValueChange={(value) => setForm((current) => ({ ...current, docId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a document" />
                </SelectTrigger>
                <SelectContent>
                  {docs.map((doc) => (
                    <SelectItem key={doc.id} value={doc.id}>
                      {doc.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="req-code">Code</Label>
              <Input id="req-code" value={form.code} onChange={set("code")} placeholder="FR-012" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="req-section">Section</Label>
              <Input id="req-section" value={form.section} onChange={set("section")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="req-title">Title</Label>
            <Input id="req-title" value={form.title} onChange={set("title")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="req-description">Description</Label>
            <Textarea id="req-description" rows={3} value={form.description} onChange={set("description")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="req-ac">Acceptance criteria</Label>
            <Textarea
              id="req-ac"
              rows={4}
              value={form.acceptanceCriteria}
              onChange={set("acceptanceCriteria")}
              placeholder="- One condition per line"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="req-questions">Open questions</Label>
            <Textarea id="req-questions" rows={2} value={form.openQuestions} onChange={set("openQuestions")} />
          </div>
        </div>

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

/**
 * Whether the PO confirmed the requirement: a quiet tick when they did, an
 * amber "Not verified" while its drafts wait for them.
 */
function VerifiedMark({ requirement }: { requirement: RequirementDto }) {
  if (requirement.verifiedAt) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 text-xs text-status-passed"
        title={`Verified${requirement.verifiedBy ? ` by ${requirement.verifiedBy.name}` : ""} on ${formatDateTime(requirement.verifiedAt)}`}
      >
        <BadgeCheck className="size-3.5" aria-hidden />
        Verified
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center rounded border border-status-blocked/40 px-1 text-xs text-status-blocked"
      title="The PO has not confirmed this requirement yet. Its drafts become test cases once they do."
    >
      Not verified
    </span>
  );
}
