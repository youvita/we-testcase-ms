"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLATFORM_LABELS } from "@/lib/constants";
import { api, errorMessage } from "@/utils/api-client";
import type {
  CopyTarget,
  ProjectCopyInput,
  ProjectCopyPreview,
  ProjectCopySummary,
} from "@wetestcase/dto";

import type { ModuleOption } from "./test-case-form-dialog";

/** "Whole project", or a module id. */
const WHOLE_PROJECT = "__project__";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Copy test cases, with their scripts, into another project.
 *
 * Opened from the selection bar with the ticked cases, or from the header
 * with no selection — then it asks for the whole project or one module. The
 * preview re-runs on every choice, so the numbers beside the Copy button are
 * always what clicking it will do.
 */
export function CopyToProjectDialog({
  projectId,
  open,
  onOpenChange,
  selectedIds,
  modules = [],
  onCopied,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The ticked cases; omit to choose the whole project or a module. */
  selectedIds?: string[];
  modules?: ModuleOption[];
  onCopied?: () => void;
}) {
  const router = useRouter();
  const [targets, setTargets] = useState<CopyTarget[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [scopeChoice, setScopeChoice] = useState(WHOLE_PROJECT);
  const [mode, setMode] = useState<"skip" | "overwrite">("skip");
  const [includeEnvironments, setIncludeEnvironments] = useState(true);
  const [includeRequirements, setIncludeRequirements] = useState(true);
  const [preview, setPreview] = useState<ProjectCopyPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  const request: ProjectCopyInput | null = targetId
    ? {
        targetProjectId: targetId,
        scope: selectedIds
          ? { kind: "cases", ids: selectedIds }
          : scopeChoice === WHOLE_PROJECT
            ? { kind: "project" }
            : { kind: "module", moduleId: scopeChoice },
        mode,
        includeEnvironments,
        includeRequirements,
      }
    : null;
  // A stable key, so the preview effect re-runs on a real change only.
  const requestKey = request ? JSON.stringify(request) : "";

  useEffect(() => {
    if (!open || targets) return;
    api
      .get<CopyTarget[]>(`/api/projects/${projectId}/copy`)
      .then((list) => {
        setTargets(list);
        // Only one place it can go: choose it, rather than ask.
        if (list.length === 1) setTargetId(list[0]!.id);
      })
      .catch((error) => {
        setTargets([]);
        toast.error(errorMessage(error));
      });
  }, [open, targets, projectId]);

  useEffect(() => {
    if (!open || !requestKey) return;
    let cancelled = false;
    setPreviewing(true);
    setPreviewError(null);
    api
      .post<ProjectCopyPreview>(`/api/projects/${projectId}/copy/preview`, JSON.parse(requestKey))
      .then((result) => !cancelled && setPreview(result))
      .catch((error) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(errorMessage(error));
      })
      .finally(() => !cancelled && setPreviewing(false));
    return () => {
      cancelled = true;
    };
  }, [open, requestKey, projectId]);

  function handleOpenChange(next: boolean) {
    if (copying) return;
    if (!next) {
      setTargetId("");
      setScopeChoice(WHOLE_PROJECT);
      setMode("skip");
      setPreview(null);
      setPreviewError(null);
      setTargets(null);
    }
    onOpenChange(next);
  }

  async function handleCopy() {
    if (!request) return;
    setCopying(true);
    try {
      const result = await api.post<ProjectCopySummary>(`/api/projects/${projectId}/copy`, request);
      announce(result, () => router.push(`/projects/${result.targetProjectId}/test-cases`));
      setCopying(false);
      handleOpenChange(false);
      onCopied?.();
    } catch (error) {
      toast.error(errorMessage(error));
      setCopying(false);
    }
  }

  const nothingToWrite = preview !== null && preview.newCases === 0 && mode === "skip";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy to another project</DialogTitle>
          <DialogDescription>
            {selectedIds
              ? `Copy ${plural(selectedIds.length, "selected test case")} and their scripts.`
              : "Copy test cases and their scripts."}{" "}
            Results, history and comments stay here; copies start as Not run.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="copy-target">Copy to</Label>
            {targets?.length === 0 ? (
              // An empty list would open onto nothing: say why, and offer the way out.
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-3">
                <p className="text-sm text-muted-foreground">
                  There is no other project to copy to yet.
                </p>
                <Button size="sm" asChild>
                  <Link href="/projects?new=1">
                    <Plus className="mr-2 size-4" />
                    Create project
                  </Link>
                </Button>
              </div>
            ) : (
              <Select value={targetId} onValueChange={setTargetId} disabled={!targets}>
                <SelectTrigger id="copy-target">
                  <SelectValue placeholder={targets ? "Choose a project" : "Loading projects…"} />
                </SelectTrigger>
                <SelectContent>
                  {targets?.map((target) => (
                    <SelectItem key={target.id} value={target.id}>
                      {target.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {!selectedIds && (
            <div className="space-y-2">
              <Label htmlFor="copy-scope">What to copy</Label>
              <Select value={scopeChoice} onValueChange={setScopeChoice}>
                <SelectTrigger id="copy-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WHOLE_PROJECT}>Whole project</SelectItem>
                  {modules.map((module) => (
                    <SelectItem key={module.id} value={module.id}>
                      Module: {module.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2.5">
            <p className="text-sm font-medium">Also copy</p>
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={includeEnvironments}
                onCheckedChange={(checked) => setIncludeEnvironments(checked === true)}
              />
              <span>
                Run environments
                <span className="block text-xs text-muted-foreground">
                  URLs and variables. Secret values are left blank to fill in
                  there; an environment the project already has is kept as is.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={includeRequirements}
                onCheckedChange={(checked) => setIncludeRequirements(checked === true)}
              />
              <span>
                Requirements and their links
                <span className="block text-xs text-muted-foreground">
                  {selectedIds || scopeChoice !== WHOLE_PROJECT
                    ? "The requirements these cases verify, and their documents."
                    : "Every requirement document, with its current text."}
                </span>
              </span>
            </label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="copy-mode">If a TC ID already exists there</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as "skip" | "overwrite")}>
              <SelectTrigger id="copy-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">Skip it (keep the existing test case)</SelectItem>
                <SelectItem value="overwrite">Overwrite it (replace details and script)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Either way, results recorded there are never overwritten.
            </p>
          </div>

          {previewing && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Checking the target project…
            </p>
          )}
          {previewError && !previewing && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertDescription>{previewError}</AlertDescription>
            </Alert>
          )}
          {preview && !previewing && <CopyPreviewPanel preview={preview} mode={mode} />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={copying}>
            Cancel
          </Button>
          <Button
            onClick={handleCopy}
            disabled={!preview || previewing || copying || nothingToWrite}
            title={nothingToWrite ? "Every case already exists there — choose Overwrite to replace them" : undefined}
          >
            {copying ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Copy className="mr-2 size-4" />}
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What the copy will do, before the click. */
function CopyPreviewPanel({ preview, mode }: { preview: ProjectCopyPreview; mode: "skip" | "overwrite" }) {
  const counts = [
    { label: "new", value: preview.newCases },
    { label: mode === "skip" ? "skipped" : "overwritten", value: preview.existing },
    { label: preview.scripts === 1 ? "script" : "scripts", value: preview.scripts },
  ];
  const notes = [
    preview.newModules > 0 && `${plural(preview.newModules, "module")} will be created`,
    preview.platformsAdded.length > 0 &&
      `${preview.platformsAdded.map((p) => PLATFORM_LABELS[p]).join(", ")} will be added to its platforms`,
    preview.newEnvironments > 0 && `${plural(preview.newEnvironments, "run environment")} will be added`,
    preview.existingEnvironments > 0 &&
      `${plural(preview.existingEnvironments, "run environment")} already there by name — kept as is`,
    preview.newRequirementDocs > 0 && `${plural(preview.newRequirementDocs, "requirement document")} will be added`,
    preview.newRequirements > 0 && `${plural(preview.newRequirements, "requirement")} will be added`,
    preview.scripts > 0 && "Scripts arrive as drafts until they pass there",
  ].filter(Boolean);

  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
      <p className="text-sm font-medium">
        {plural(preview.cases, "test case")} to {preview.targetProjectName}
      </p>
      <dl className="grid grid-cols-3 gap-3">
        {counts.map((item) => (
          <div key={item.label}>
            <dd className="text-lg font-semibold tabular-nums">{item.value}</dd>
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
          </div>
        ))}
      </dl>
      {notes.length > 0 && (
        <ul className="space-y-0.5 border-t pt-3 text-xs text-muted-foreground">
          {notes.map((note) => (
            <li key={note as string}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One toast for the result; a second, lasting one when secrets need filling. */
function announce(result: ProjectCopySummary, openTarget: () => void) {
  const changed = result.created + result.updated;
  toast.success(
    `Copied ${plural(changed, "test case")} to ${result.targetProjectName}`,
    {
      description: [
        result.updated > 0 && `${result.updated} overwritten`,
        result.skipped.length > 0 && `${result.skipped.length} skipped (already there)`,
        result.scriptsCopied > 0 && plural(result.scriptsCopied, "script"),
        result.environmentsCreated.length > 0 && plural(result.environmentsCreated.length, "environment"),
        result.requirementsCreated > 0 && plural(result.requirementsCreated, "requirement"),
      ]
        .filter(Boolean)
        .join(" · "),
      action: { label: "Open", onClick: openTarget },
    },
  );

  if (result.secretsToFill.length > 0) {
    toast.warning("Fill in secret values in the copied environments", {
      description: result.secretsToFill
        .map((item) => `${item.environment}: ${item.keys.join(", ")}`)
        .join(" · "),
      duration: Infinity,
      closeButton: true,
    });
  }
}
