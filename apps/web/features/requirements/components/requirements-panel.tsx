"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
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
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { EXECUTION_STATUS_LABELS, PLATFORM_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type {
  AiJobDto,
  GenerationDepth,
  Platform,
  RequirementDocDto,
  RequirementDto,
} from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";

import type { StartAi } from "./requirements-workspace";

type Coverage = "all" | "uncovered" | "covered" | "questions";

export function RequirementsPanel({
  projectId,
  docs,
  requirements,
  platforms,
  canManage,
  generating,
  startAi,
  onOpenDocuments,
}: {
  projectId: string;
  docs: RequirementDocDto[];
  requirements: RequirementDto[];
  platforms: Platform[];
  canManage: boolean;
  generating: boolean;
  startAi: StartAi;
  onOpenDocuments: () => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [docFilter, setDocFilter] = useState("all");
  const [coverage, setCoverage] = useState<Coverage>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [generateOpen, setGenerateOpen] = useState(false);
  const [editing, setEditing] = useState<RequirementDto | "new" | null>(null);
  const [deleting, setDeleting] = useState<RequirementDto | null>(null);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return requirements.filter((req) => {
      if (docFilter !== "all" && req.docId !== docFilter) return false;
      if (coverage === "uncovered" && req.testCases.length > 0) return false;
      if (coverage === "covered" && req.testCases.length === 0) return false;
      if (coverage === "questions" && !req.openQuestions) return false;
      if (!term) return true;
      return [req.code, req.title, req.description, req.section]
        .filter(Boolean)
        .some((text) => text!.toLowerCase().includes(term));
    });
  }, [requirements, search, docFilter, coverage]);

  // Selection survives filtering, so it is counted against what still exists.
  const selectedIds = requirements
    .filter((req) => selected.has(req.id))
    .map((req) => req.id);
  const allVisibleSelected =
    visible.length > 0 && visible.every((req) => selected.has(req.id));

  function toggle(set: Set<string>, id: string, on: boolean) {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
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
                {docs.map((doc) => (
                  <SelectItem key={doc.id} value={doc.id}>
                    {doc.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={coverage} onValueChange={(value) => setCoverage(value as Coverage)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All requirements</SelectItem>
              <SelectItem value="uncovered">Not covered</SelectItem>
              <SelectItem value="covered">Covered</SelectItem>
              <SelectItem value="questions">With open questions</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
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

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {canManage && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all shown"
                    checked={allVisibleSelected}
                    onCheckedChange={(checked) => {
                      const next = new Set(selected);
                      for (const req of visible) {
                        if (checked) next.add(req.id);
                        else next.delete(req.id);
                      }
                      setSelected(next);
                    }}
                  />
                </TableHead>
              )}
              <TableHead className="w-8" />
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
            {visible.map((req) => {
              const open = expanded.has(req.id);
              return (
                <Fragment key={req.id}>
                  <TableRow data-state={selected.has(req.id) ? "selected" : undefined}>
                    {canManage && (
                      <TableCell>
                        <Checkbox
                          aria-label={`Select ${req.code}`}
                          checked={selected.has(req.id)}
                          onCheckedChange={(checked) =>
                            setSelected(toggle(selected, req.id, checked === true))
                          }
                        />
                      </TableCell>
                    )}
                    <TableCell className="px-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={open ? "Hide details" : "Show details"}
                        onClick={() => setExpanded(toggle(expanded, req.id, !open))}
                      >
                        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </Button>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{req.code}</TableCell>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <span className="font-medium">{req.title}</span>
                        {req.openQuestions && (
                          <CircleHelp
                            className="mt-0.5 size-4 shrink-0 text-status-blocked"
                            aria-label="Has open questions"
                          />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[req.section, docs.length > 1 ? req.docTitle : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
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
                            <DropdownMenuItem onSelect={() => setEditing(req)}>
                              <Pencil className="mr-2 size-4" />
                              Edit
                            </DropdownMenuItem>
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
                      <TableCell colSpan={canManage ? 6 : 4} className="space-y-3 py-4 pl-14 text-sm">
                        <Detail label="Description" text={req.description} />
                        <Detail label="Acceptance criteria" text={req.acceptanceCriteria} />
                        <Detail
                          label="Open questions — ask the product owner"
                          text={req.openQuestions}
                          className="text-status-blocked"
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <GenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        count={selectedIds.length}
        platforms={platforms}
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
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  platforms: Platform[];
  onGenerate: (options: {
    platform: Platform;
    depth: GenerationDepth;
    instructions: string;
  }) => Promise<void>;
}) {
  const [platform, setPlatform] = useState<Platform>(platforms[0] ?? "WEB");
  const [depth, setDepth] = useState<GenerationDepth>("essential");
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
            </div>
            <div className="space-y-2">
              <Label>Depth</Label>
              <Select value={depth} onValueChange={(value) => setDepth(value as GenerationDepth)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="essential">Essential — 1–3 per requirement</SelectItem>
                  <SelectItem value="thorough">Thorough — 3–8 per requirement</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
                await onGenerate({ platform, depth, instructions });
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
            Reading the document again updates requirements by code, so edits
            to a code&apos;s text may be replaced then.
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
