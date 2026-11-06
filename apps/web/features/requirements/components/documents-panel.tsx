"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  History,
  Loader2,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationControls } from "@/components/shared/pagination-controls";
import {
  REQUIREMENT_DOC_KINDS,
  type AiJobDto,
  type RequirementDocDto,
  type RequirementDocKind,
  type RequirementDocVersionDto,
} from "@wetestcase/dto";
import { cn } from "@/lib/utils";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { api, downloadFile, errorMessage } from "@/utils/api-client";
import { formatRelative } from "@/utils/format";

import type { StartAi } from "./requirements-workspace";

const ACCEPT = ".pdf,.docx,.md,.markdown,.txt,.html,.htm,.json,.yaml,.yml,.xlsx,.xls,.csv";
/** Swagger / OpenAPI specs and Postman collections come as JSON or YAML. */
const isSpecFile = (name: string) => /\.(json|ya?ml)$/i.test(name);

export function DocumentsPanel({
  projectId,
  docs,
  canManage,
  activeDocIds,
  startAi,
}: {
  projectId: string;
  docs: RequirementDocDto[];
  canManage: boolean;
  activeDocIds: Set<string>;
  startAi: StartAi;
}) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newVersionOf, setNewVersionOf] = useState<RequirementDocDto | null>(null);
  const [viewing, setViewing] = useState<{ doc: RequirementDocDto; version?: number } | null>(null);
  const [moving, setMoving] = useState<RequirementDocDto | null>(null);
  const [history, setHistory] = useState<RequirementDocDto | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<RequirementDocDto | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<RequirementDocKind | "all">("all");
  const [readFilter, setReadFilter] = useState<"all" | "read" | "unread">("all");

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return docs.filter((doc) => {
      if (kindFilter !== "all" && doc.kind !== kindFilter) return false;
      if (readFilter === "read" && doc.requirementCount === 0) return false;
      if (readFilter === "unread" && doc.requirementCount > 0) return false;
      if (!term) return true;
      return [doc.title, doc.fileName, doc.createdBy.name, doc.folder]
        .filter(Boolean)
        .some((text) => text!.toLowerCase().includes(term));
    });
  }, [docs, search, kindFilter, readFilter]);

  const paging = useClientPagination(visible, `${search}|${kindFilter}|${readFilter}`);

  // The project's feature folders, for picking one.
  const folders = useMemo(
    () => [...new Set(docs.map((doc) => doc.folder).filter((f): f is string => Boolean(f)))].sort((a, b) => a.localeCompare(b)),
    [docs],
  );
  // Once any document is in a folder, the list is by folder — each feature's
  // documents together, with when the feature last changed. Otherwise flat.
  const grouped = folders.length > 0;
  const groups = useMemo(() => {
    const byFolder = new Map<string, RequirementDocDto[]>();
    for (const doc of visible) {
      const key = doc.folder ?? "";
      byFolder.set(key, [...(byFolder.get(key) ?? []), doc]);
    }
    return [...byFolder.entries()]
      .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
      .map(([folder, items]) => ({
        folder,
        items,
        updatedAt: items.reduce((latest, doc) => (doc.versionAt > latest ? doc.versionAt : latest), ""),
      }));
  }, [visible]);
  const searching = search.trim() !== "";

  function extract(docId: string) {
    return startAi(() =>
      api.post<AiJobDto>(`/api/requirement-docs/${docId}/extract`),
    );
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await api.delete(`/api/requirement-docs/${deleting.id}`);
      toast.success(`Deleted "${deleting.title}"`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  }

  function renderDoc(doc: RequirementDocDto) {
    const reading = activeDocIds.has(doc.id);
    return (
      <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
        <FileText className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{doc.title}</span>
            <Badge variant="outline">{doc.kind}</Badge>
            {doc.version > 1 && <Badge variant="secondary">v{doc.version}</Badge>}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {doc.fileName ?? "Pasted text"} ·{" "}
            {Math.round(doc.charCount / 1000)}k characters ·{" "}
            {doc.kind === "PRD"
              ? `background for drafting${doc.requirementCount > 0 ? ` · ${doc.requirementCount} requirements read earlier` : ""}`
              : `${doc.requirementCount} requirements`}{" "}
            ·{" "}
            {doc.version > 1
              ? `v${doc.version} uploaded by ${doc.versionBy?.name ?? "someone"} ${formatRelative(doc.versionAt)}`
              : `added by ${doc.createdBy.name} ${formatRelative(doc.createdAt)}`}
          </p>
        </div>

        {canManage && doc.kind !== "PRD" && (
          <Button
            size="sm"
            variant={doc.requirementCount === 0 ? "default" : "outline"}
            disabled={reading}
            onClick={() => void extract(doc.id)}
          >
            {reading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 size-4" />
            )}
            {reading
              ? "Reading…"
              : doc.requirementCount === 0
                ? "Read requirements"
                : "Read again"}
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Document actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setViewing({ doc })}>
              <Eye className="mr-2 size-4" />
              View text
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void download(doc.id)}>
              <Download className="mr-2 size-4" />
              Download as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setHistory(doc)}>
              <History className="mr-2 size-4" />
              Version history{doc.version > 1 && ` (${doc.version})`}
            </DropdownMenuItem>
            {canManage && (
              <DropdownMenuItem disabled={reading} onSelect={() => setNewVersionOf(doc)}>
                <FilePlus2 className="mr-2 size-4" />
                Upload new version
              </DropdownMenuItem>
            )}
            {canManage && (
              <DropdownMenuItem onSelect={() => setMoving(doc)}>
                <FolderInput className="mr-2 size-4" />
                Move to folder…
              </DropdownMenuItem>
            )}
            {canManage && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setDeleting(doc)}
              >
                <Trash2 className="mr-2 size-4" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
            }

  return (
    <div className="space-y-4">
      {docs.length > 0 && (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-full sm:w-64"
              placeholder="Search title, file, author…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select
              value={kindFilter}
              onValueChange={(value) => setKindFilter(value as RequirementDocKind | "all")}
            >
              <SelectTrigger className="w-40" aria-label="Filter by type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {REQUIREMENT_DOC_KINDS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option === "OTHER" ? "Other spec" : option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={readFilter}
              onValueChange={(value) => setReadFilter(value as "all" | "read" | "unread")}
            >
              <SelectTrigger className="w-48" aria-label="Filter by reading">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Read and not read</SelectItem>
                <SelectItem value="read">Requirements read</SelectItem>
                <SelectItem value="unread">Not read yet</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {canManage && (
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="mr-2 size-4" />
              Add document
            </Button>
          )}
        </div>
      )}

      {docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description={
            canManage
              ? "Upload the FRD — PDF, Word, Excel, Markdown or HTML — or a Swagger / OpenAPI spec or Postman collection, or paste its text. The AI reads it into a list of testable requirements. Add the PRD too: the AI uses it as product background when it drafts test cases."
              : "QA has not added any requirement documents to this project yet."
          }
          action={
            canManage ? (
              <Button onClick={() => setUploadOpen(true)}>
                <Upload className="mr-2 size-4" />
                Add document
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {visible.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No documents match these filters.
              </p>
            )}
            {grouped
              ? groups.map((group) => {
                  const open = searching || !collapsed.has(group.folder);
                  return (
                    <div key={group.folder || "-"}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 bg-muted/40 px-4 py-2 text-left text-sm hover:bg-muted/60"
                        aria-expanded={open}
                        onClick={() =>
                          setCollapsed((current) => {
                            const next = new Set(current);
                            if (open) next.add(group.folder);
                            else next.delete(group.folder);
                            return next;
                          })
                        }
                      >
                        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        <Folder className="size-4 text-muted-foreground" aria-hidden />
                        <span className={cn("font-medium", !group.folder && "text-muted-foreground")}>
                          {group.folder || "No folder"}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {group.items.length} document{group.items.length === 1 ? "" : "s"} · updated{" "}
                          {formatRelative(group.updatedAt)}
                        </span>
                      </button>
                      {open && <div className="divide-y border-t">{group.items.map(renderDoc)}</div>}
                    </div>
                  );
                })
              : paging.pageItems.map(renderDoc)}
          </CardContent>
        </Card>
      )}

      {visible.length > 0 && !grouped && (
        <PaginationControls
          page={paging.page}
          pageSize={paging.pageSize}
          total={paging.total}
          totalPages={paging.totalPages}
          onPageChange={paging.setPage}
          onPageSizeChange={paging.setPageSize}
        />
      )}

      <UploadDialog
        projectId={projectId}
        folders={folders}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(docId, kind) => {
          router.refresh();
          if (kind !== "PRD") void extract(docId);
        }}
      />

      <UploadDialog
        projectId={projectId}
        folders={folders}
        newVersionOf={newVersionOf}
        open={newVersionOf !== null}
        onOpenChange={(open) => !open && setNewVersionOf(null)}
        onUploaded={(docId, kind) => {
          router.refresh();
          if (kind !== "PRD") void extract(docId);
        }}
      />

      <DocumentTextDialog doc={viewing?.doc ?? null} version={viewing?.version} onClose={() => setViewing(null)} />

      <MoveToFolderDialog doc={moving} folders={folders} onClose={() => setMoving(null)} />

      <VersionHistoryDialog
        doc={history}
        onClose={() => setHistory(null)}
        onView={(doc, version) => setViewing({ doc, version })}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete "${deleting?.title ?? ""}"?`}
        description={
          deleting && deleting.requirementCount > 0
            ? `Its ${deleting.requirementCount} requirements are deleted with it, and their links to test cases are removed. The test cases themselves stay.`
            : "The document is removed from this project."
        }
        onConfirm={handleDelete}
      />
    </div>
  );
}

/**
 * Add a document, or — with `newVersionOf` — replace an existing one's text
 * with a newer version, whose reading is then compared with the one before.
 */
function UploadDialog({
  projectId,
  folders,
  newVersionOf,
  open,
  onOpenChange,
  onUploaded,
}: {
  projectId: string;
  /** The project's folders, to pick one. */
  folders: string[];
  newVersionOf?: RequirementDocDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A PRD is background for drafting, so it is not read. */
  onUploaded: (docId: string, kind: RequirementDocKind) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("");
  // FRD first: it is what requirements are read from; a PRD is background.
  const [kind, setKind] = useState<RequirementDocKind>("FRD");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setFile(null);
    setTitle("");
    setFolder("");
    setContent("");
    setKind("FRD");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSave() {
    setSaving(true);
    try {
      const url = newVersionOf
        ? `/api/requirement-docs/${newVersionOf.id}/versions`
        : `/api/projects/${projectId}/requirement-docs`;
      let created: { id: string };
      if (mode === "file") {
        if (!file) throw new Error("Choose a file to upload");
        const form = new FormData();
        form.append("file", file);
        form.append("title", title);
        form.append("kind", kind);
        form.append("folder", folder);
        created = await api.post(url, form);
      } else {
        created = await api.post(url, newVersionOf ? { content } : { title, kind, folder, content });
      }
      const savedKind = newVersionOf?.kind ?? kind;
      toast.success(newVersionOf ? "New version uploaded" : "Document added", {
        description:
          savedKind === "PRD" ? "The AI uses it as product background whenever it drafts test cases." : undefined,
      });
      reset();
      onOpenChange(false);
      onUploaded(created.id, savedKind);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const ready =
    mode === "file"
      ? file !== null
      : (newVersionOf || title.trim().length >= 2) && content.trim().length >= 50;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {newVersionOf
              ? `New version of "${newVersionOf.title}"`
              : "Add a requirements document"}
          </DialogTitle>
          <DialogDescription>
            {newVersionOf
              ? newVersionOf.kind === "PRD"
                ? `Replaces version ${newVersionOf.version}, which is kept. Drafting uses the new text as product background from now on.`
                : `Replaces version ${newVersionOf.version}, which is kept. The AI reads the new text on your Claude subscription and marks each requirement new, changed or not found, so you can review the test cases linked to them.`
              : kind === "PRD"
                ? "A PRD is product background: it is not read into requirements, and the AI reads it whenever it drafts test cases."
                : "The AI reads it into requirements as soon as it is added, on your Claude subscription."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => setMode(value as "file" | "paste")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="file">Upload a file</TabsTrigger>
            <TabsTrigger value="paste">Paste text</TabsTrigger>
          </TabsList>

          <div className={cn("mt-4 grid gap-4 sm:grid-cols-[1fr_140px]", newVersionOf && "hidden")}>
            <div className="space-y-2">
              <Label htmlFor="doc-title">Title</Label>
              <Input
                id="doc-title"
                value={title}
                placeholder={mode === "file" ? "Defaults to the file name" : "e.g. Payment FRD v1.2"}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-kind">Type</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as RequirementDocKind)}>
                <SelectTrigger id="doc-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REQUIREMENT_DOC_KINDS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "OTHER" ? "Other spec" : option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className={cn("mt-4 space-y-2", newVersionOf && "hidden")}>
            <Label htmlFor="doc-folder">Folder</Label>
            <FolderField id="doc-folder" value={folder} onChange={setFolder} folders={folders} />
          </div>

          <TabsContent value="file" className="mt-4 space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setFile(picked);
                // An API spec is neither a PRD nor an FRD.
                if (picked && isSpecFile(picked.name)) setKind("OTHER");
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
            >
              <Upload className="size-5" />
              {file ? (
                <span className="font-medium text-foreground">{file.name}</span>
              ) : (
                <span>
                  Choose a PDF, Word (.docx), Excel (.xlsx, .csv), Markdown, text or HTML file, or a
                  Swagger / OpenAPI spec or Postman collection (.json, .yaml) — up to 20 MB
                </span>
              )}
            </button>
            <p className="text-xs text-muted-foreground">
              {file && isSpecFile(file.name)
                ? "Each endpoint becomes its own section with its fields, responses and checks — reading it gives one requirement per endpoint. Variable values and credentials are not copied."
                : "Scanned PDFs have no text to read; export the original document instead."}
            </p>
          </TabsContent>

          <TabsContent value="paste" className="mt-4">
            <Textarea
              rows={12}
              value={content}
              placeholder="Paste the document here. Headings help the AI keep sections apart."
              onChange={(event) => setContent(event.target.value)}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready || saving} onClick={() => void handleSave()}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {newVersionOf ? "Upload and compare" : "Add and read"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The document's text as a Markdown file; the original upload is not kept. */
async function download(docId: string, version?: number) {
  try {
    await downloadFile(`/api/requirement-docs/${docId}/download${version ? `?version=${version}` : ""}`);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

function DocumentTextDialog({
  doc,
  version,
  onClose,
}: {
  doc: RequirementDocDto | null;
  /** An earlier version; the current one when absent. */
  version?: number;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const docId = doc?.id;
  const query = version ? `?version=${version}` : "";

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    setContent(null);
    api
      .get<{ content: string }>(`/api/requirement-docs/${docId}${query}`)
      .then((result) => {
        if (!cancelled) setContent(result.content);
      })
      .catch((error) => toast.error(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [docId, query]);

  return (
    <Dialog open={doc !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {doc?.title}
            {version && version !== doc?.version && ` — version ${version}`}
          </DialogTitle>
          <DialogDescription>The text the AI reads — as extracted from {doc?.fileName ?? "the pasted text"}.</DialogDescription>
        </DialogHeader>
        {doc && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => void download(doc.id, version)}>
              <Download className="mr-2 size-4" />
              Download
            </Button>
          </div>
        )}
        {content === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-xs leading-relaxed">
            {content}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A folder name: one of the project's, or a new one typed in.
 *
 * Its own list rather than a <datalist>: browsers draw a datalist's popup
 * detached from the field inside a dialog (it floated over the Title field).
 */
function FolderField({
  id,
  value,
  onChange,
  folders,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  folders: string[];
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const term = value.trim().toLowerCase();
  const matches = folders.filter((folder) => !term || folder.toLowerCase().includes(term));
  const isNew = term !== "" && !folders.some((folder) => folder.toLowerCase() === term);
  const showList = open && (matches.length > 0 || isNew);

  function pick(folder: string) {
    onChange(folder);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={value}
        maxLength={80}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        className={cn(folders.length > 0 && "pr-9")}
        placeholder={folders.length ? "Pick a feature or type a new one" : "e.g. Billing — leave empty for none"}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (!showList) {
            if (event.key === "ArrowDown") setOpen(true);
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive((current) =>
              event.key === "ArrowDown" ? Math.min(current + 1, matches.length - 1) : Math.max(current - 1, -1),
            );
          } else if (event.key === "Enter" && active >= 0 && active < matches.length) {
            // Picks the highlighted folder instead of submitting the form.
            event.preventDefault();
            pick(matches[active]!);
          }
        }}
      />
      {folders.length > 0 && (
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      )}
      {showList && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
        >
          {matches.map((folder, index) => (
            <li
              key={folder}
              role="option"
              aria-selected={folder === value.trim()}
              // mousedown, not click: the field's blur would close the list first.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(folder);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5",
                index === active && "bg-accent text-accent-foreground",
              )}
            >
              <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{folder}</span>
              {folder === value.trim() && <Check className="ml-auto size-4 shrink-0" aria-hidden />}
            </li>
          ))}
          {isNew && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(value.trim());
              }}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-muted-foreground hover:bg-accent"
            >
              <Plus className="size-4 shrink-0" aria-hidden />
              New folder “{value.trim()}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Put a document in another feature folder, or in none. */
function MoveToFolderDialog({
  doc,
  folders,
  onClose,
}: {
  doc: RequirementDocDto | null;
  folders: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [folder, setFolder] = useState("");
  const [saving, setSaving] = useState(false);
  const [shownFor, setShownFor] = useState<string | null>(null);
  if ((doc?.id ?? null) !== shownFor) {
    setShownFor(doc?.id ?? null);
    setFolder(doc?.folder ?? "");
  }

  async function save() {
    if (!doc) return;
    setSaving(true);
    try {
      await api.patch(`/api/requirement-docs/${doc.id}`, { folder: folder.trim() || null });
      toast.success(folder.trim() ? `Moved to ${folder.trim()}` : "Taken out of its folder");
      onClose();
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={doc !== null} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move “{doc?.title}”</DialogTitle>
          <DialogDescription>
            Keep a feature’s documents together. Leave it empty to take the document out of any folder.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FolderField id="move-folder" value={folder} onChange={setFolder} folders={folders} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || folder.trim() === (doc?.folder ?? "")}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Every version of a document, newest first, to view or download. */
function VersionHistoryDialog({
  doc,
  onClose,
  onView,
}: {
  doc: RequirementDocDto | null;
  onClose: () => void;
  onView: (doc: RequirementDocDto, version: number) => void;
}) {
  const [versions, setVersions] = useState<RequirementDocVersionDto[] | null>(null);
  const docId = doc?.id;

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    setVersions(null);
    api
      .get<RequirementDocVersionDto[]>(`/api/requirement-docs/${docId}/versions`)
      .then((result) => {
        if (!cancelled) setVersions(result);
      })
      .catch((error) => toast.error(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [docId]);

  return (
    <Dialog open={doc !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Versions of “{doc?.title}”</DialogTitle>
          <DialogDescription>
            Every uploaded version is kept. Requirements follow the current one; after a new version,
            the Requirements tab shows which were added, changed or not found.
          </DialogDescription>
        </DialogHeader>
        {versions === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ul className="divide-y rounded-md border">
            {versions.map((v) => (
              <li key={v.version} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Version {v.version}
                    {v.current && (
                      <Badge variant="secondary" className="ml-2 font-normal">
                        Current
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {v.uploadedBy?.name ?? "Someone"} · {formatRelative(v.uploadedAt)} ·{" "}
                    {v.fileName ?? "Pasted text"} · {Math.max(1, Math.round(v.charCount / 1000))}k characters
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`View version ${v.version}`}
                  onClick={() => doc && onView(doc, v.version)}
                >
                  <Eye className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Download version ${v.version}`}
                  onClick={() => doc && void download(doc.id, v.version)}
                >
                  <Download className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
