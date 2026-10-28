"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Eye,
  FilePlus2,
  FileText,
  Loader2,
  MoreHorizontal,
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
import {
  REQUIREMENT_DOC_KINDS,
  type AiJobDto,
  type RequirementDocDto,
  type RequirementDocKind,
} from "@wetestcase/dto";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/utils/api-client";
import { formatRelative } from "@/utils/format";

import type { StartAi } from "./requirements-workspace";

const ACCEPT = ".pdf,.docx,.md,.markdown,.txt,.html,.htm";

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
  const [viewing, setViewing] = useState<RequirementDocDto | null>(null);
  const [deleting, setDeleting] = useState<RequirementDocDto | null>(null);

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

  return (
    <div className="space-y-4">
      {canManage && docs.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="mr-2 size-4" />
            Add document
          </Button>
        </div>
      )}

      {docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description={
            canManage
              ? "Upload the PRD or FRD — PDF, Word, Markdown or HTML — or paste its text. The AI reads it into a list of testable requirements."
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
            {docs.map((doc) => {
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
                      {doc.requirementCount} requirements · added by{" "}
                      {doc.createdBy.name} {formatRelative(doc.createdAt)}
                    </p>
                  </div>

                  {canManage && (
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
                      <DropdownMenuItem onSelect={() => setViewing(doc)}>
                        <Eye className="mr-2 size-4" />
                        View text
                      </DropdownMenuItem>
                      {canManage && (
                        <DropdownMenuItem disabled={reading} onSelect={() => setNewVersionOf(doc)}>
                          <FilePlus2 className="mr-2 size-4" />
                          Upload new version
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
            })}
          </CardContent>
        </Card>
      )}

      <UploadDialog
        projectId={projectId}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(docId) => {
          router.refresh();
          void extract(docId);
        }}
      />

      <UploadDialog
        projectId={projectId}
        newVersionOf={newVersionOf}
        open={newVersionOf !== null}
        onOpenChange={(open) => !open && setNewVersionOf(null)}
        onUploaded={(docId) => {
          router.refresh();
          void extract(docId);
        }}
      />

      <DocumentTextDialog doc={viewing} onClose={() => setViewing(null)} />

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
  newVersionOf,
  open,
  onOpenChange,
  onUploaded,
}: {
  projectId: string;
  newVersionOf?: RequirementDocDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (docId: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<RequirementDocKind>("PRD");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setFile(null);
    setTitle("");
    setContent("");
    setKind("PRD");
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
        created = await api.post(url, form);
      } else {
        created = await api.post(url, newVersionOf ? { content } : { title, kind, content });
      }
      toast.success(newVersionOf ? "New version uploaded" : "Document added");
      reset();
      onOpenChange(false);
      onUploaded(created.id);
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
              ? `Replaces version ${newVersionOf.version}, which is kept. The AI reads the new text on your Claude subscription and marks each requirement new, changed or not found, so you can review the test cases linked to them.`
              : "The AI starts reading it as soon as it is added, on your Claude subscription."}
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

          <TabsContent value="file" className="mt-4 space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
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
                <span>Choose a PDF, Word (.docx), Markdown, text or HTML file — up to 20 MB</span>
              )}
            </button>
            <p className="text-xs text-muted-foreground">
              Scanned PDFs have no text to read; export the original document instead.
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

function DocumentTextDialog({
  doc,
  onClose,
}: {
  doc: RequirementDocDto | null;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const docId = doc?.id;

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    setContent(null);
    api
      .get<{ content: string }>(`/api/requirement-docs/${docId}`)
      .then((result) => {
        if (!cancelled) setContent(result.content);
      })
      .catch((error) => toast.error(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [docId]);

  return (
    <Dialog open={doc !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{doc?.title}</DialogTitle>
          <DialogDescription>The text the AI reads — as extracted from {doc?.fileName ?? "the pasted text"}.</DialogDescription>
        </DialogHeader>
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
