"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import { withBasePath } from "@/lib/base-path";
import { api, errorMessage } from "@/utils/api-client";
import { formatBytes } from "@/utils/format";
import type { ImportPreview, ImportSummary } from "@/types";

/** Exactly what buildImportTemplate() writes, in the same order. */
const TEMPLATE_COLUMNS = [
  "TC ID",
  "Module",
  "Test Case",
  "Preconditions",
  "Steps",
  "Expected Result",
  "Test Type",
  "Priority",
  "Platform",
];

/**
 * One numbered step of the import form.
 *
 * The marker ticks over to a check once the step is satisfied, so the dialog
 * shows progress without ever blocking a step the user does not need.
 */
function Step({
  index,
  title,
  optional,
  complete,
  children,
}: {
  index: number;
  title: string;
  optional?: boolean;
  complete?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-x-3 gap-y-2">
      <span
        aria-hidden
        className={cn(
          "flex size-6 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
          complete
            ? "border-transparent bg-status-passed text-white"
            : "text-muted-foreground",
        )}
      >
        {complete ? <Check className="size-3.5" /> : index}
      </span>

      <div className="flex flex-wrap items-baseline gap-x-2">
        <p className="text-sm font-medium">
          Step {index}: {title}
        </p>
        {optional && (
          <span className="text-xs text-muted-foreground">Optional</span>
        )}
      </div>

      <div className="col-start-2">{children}</div>
    </li>
  );
}

/**
 * Excel import flow: pick a file, choose how to treat existing TC IDs, upload.
 *
 * A clean import closes the dialog and reports through a toast. The summary
 * screen appears only when rows were skipped or nothing imported — a silent
 * import that "worked" but dropped rows is the failure mode QA teams fear most
 * about tooling like this, and the preview panel has already shown the counts
 * before the commit.
 */
export function ImportDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  /**
   * Read the file as soon as it is chosen and report what the import would do.
   *
   * A dry run against the same parser the import uses, so an unreadable sheet
   * or a pile of duplicates surfaces before the commit rather than after it.
   */
  async function selectFile(next: File | null) {
    setFile(next);
    setPreview(null);
    setPreviewError(null);
    if (!next) return;

    setPreviewing(true);
    try {
      const form = new FormData();
      form.append("file", next);
      setPreview(
        await api.post<ImportPreview>(
          `/api/projects/${projectId}/import/preview`,
          form,
        ),
      );
    } catch (error) {
      setPreviewError(errorMessage(error));
    } finally {
      setPreviewing(false);
    }
  }

  function reset() {
    setFile(null);
    setSummary(null);
    setUploading(false);
    setDragging(false);
    setPreview(null);
    setPreviewError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    if (uploading) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleUpload() {
    if (!file) return;

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", mode);

      const result = await api.post<ImportSummary>(
        `/api/projects/${projectId}/import`,
        form,
      );

      const changed = result.created + result.updated;

      // Nothing to explain: every row landed. The summary screen would only
      // stand between the user and the list they came to see, so close and let
      // the toast carry the numbers.
      if (changed > 0 && result.errors.length === 0) {
        toast.success(
          `Imported ${result.created} new and updated ${result.updated} test cases`,
          {
            description: [
              `${result.rowsRead} rows read from “${result.sheetName}”`,
              result.modulesCreated.length > 0 &&
                `${result.modulesCreated.length} module${result.modulesCreated.length === 1 ? "" : "s"} created`,
            ]
              .filter(Boolean)
              .join(" · "),
          },
        );
        reset();
        onOpenChange(false);
        router.refresh();
        return;
      }

      // Rows were dropped, or nothing imported at all — that has to be shown,
      // not tucked into a toast that disappears.
      setSummary(result);
      if (changed > 0) {
        toast.warning(
          `Imported ${changed} test case${changed === 1 ? "" : "s"}, ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} skipped`,
        );
        router.refresh();
      } else {
        toast.warning("No test cases were imported — see the summary");
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import test cases from Excel</DialogTitle>
          <DialogDescription>
            Import test cases from your existing Excel file, or download our
            template to create a new one. Column names are matched
            automatically, so you don&rsquo;t need to follow the template
            exactly.
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <ImportSummaryView summary={summary} />
        ) : (
          // Numbered rather than a gated wizard: three short steps fit on one
          // screen, and hiding two of them behind Next/Back would cost clicks
          // without removing any decisions.
          <ol className="space-y-5">
            {/* Ahead of the file picker on purpose: offered afterwards, the
                template only ever arrives too late to be useful. */}
            <Step index={1} title="Download a template" optional>
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p>Includes sample columns:</p>
                  {/* A list, not a sentence: nobody reads a paragraph of
                      column names, but they will scan six bullets. */}
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    {TEMPLATE_COLUMNS.map((column) => (
                      <li key={column} className="flex gap-1.5">
                        <span aria-hidden>&bull;</span>
                        {column}
                      </li>
                    ))}
                  </ul>
                  <p>
                    Only <strong className="font-medium">Test Case</strong> is
                    required. Already have an Excel file? Skip this step.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  asChild
                >
                  <a href={withBasePath(`/api/import-template?projectId=${projectId}`)}>
                    <Download className="mr-2 size-4" />
                    Download template
                  </a>
                </Button>
              </div>
            </Step>

            <Step index={2} title="Choose your file" complete={Boolean(file)}>
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const dropped = event.dataTransfer.files[0];
                  if (dropped) void selectFile(dropped);
                }}
                className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                  dragging ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <FileUp
                  className="mx-auto size-8 text-muted-foreground"
                  aria-hidden
                />

                {file ? (
                  <div className="mt-3 space-y-1">
                    <p className="truncate text-sm font-medium text-blue-600 dark:text-blue-400">
                      {file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(file.size)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Drag &amp; drop your Excel file here
                  </p>
                )}

                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="sr-only"
                  id="import-file"
                  onChange={(event) =>
                    void selectFile(event.target.files?.[0] ?? null)
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => inputRef.current?.click()}
                >
                  {file ? "Choose a different file" : "Choose file"}
                </Button>
              </div>

              {previewing && (
                <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Reading the file…
                </p>
              )}

              {previewError && (
                <Alert variant="destructive" className="mt-3">
                  <AlertTriangle className="size-4" />
                  <AlertDescription>{previewError}</AlertDescription>
                </Alert>
              )}

              {preview && !previewing && <ImportPreviewPanel preview={preview} />}
            </Step>

            <Step index={3} title="How should duplicates be handled?">
              <div className="space-y-2">
                <Label htmlFor="import-mode" className="sr-only">
                  If a TC ID already exists
                </Label>
                <Select
                  value={mode}
                  onValueChange={(value) => setMode(value as "skip" | "update")}
                >
                  <SelectTrigger id="import-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">
                      Skip duplicates (keep existing test cases)
                    </SelectItem>
                    <SelectItem value="update">
                      Update duplicates (replace details from the sheet)
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Either way, recorded results and execution history are never
                  overwritten.
                </p>
              </div>
            </Step>
          </ol>
        )}

        <DialogFooter>
          {summary ? (
            <>
              <Button variant="outline" onClick={reset}>
                Import another file
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={uploading}
              >
                Cancel
              </Button>
              <Button onClick={handleUpload} disabled={!file || uploading}>
                {uploading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 size-4" />
                )}
                Import
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Post-import report: what landed, what did not, and why. */
/**
 * What the import will do, shown before the user commits to it.
 *
 * Duplicates get a line of their own because they are the one number that
 * changes meaning with the mode chosen in step 3 — skipped or updated.
 */
function ImportPreviewPanel({ preview }: { preview: ImportPreview }) {
  const counts = [
    { label: "test cases", value: preview.testCases },
    { label: preview.modules === 1 ? "module" : "modules", value: preview.modules },
    { label: "duplicates", value: preview.duplicates },
    { label: "new", value: preview.newCases },
  ];

  if (preview.testCases === 0) {
    return (
      <Alert variant="destructive" className="mt-3">
        <AlertTriangle className="size-4" />
        <AlertDescription>
          No importable rows were found in &ldquo;{preview.sheetName}&rdquo;.
          Check that the sheet has a header row and at least one test case.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border bg-muted/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Ready to import</p>
        <p className="text-xs text-muted-foreground">
          Estimated time: ~{preview.estimatedSeconds} second
          {preview.estimatedSeconds === 1 ? "" : "s"}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map((item) => (
          <div key={item.label}>
            <dd className="text-lg font-semibold tabular-nums">{item.value}</dd>
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
          </div>
        ))}
      </dl>

      {(preview.newModules > 0 ||
        preview.duplicatesInFile > 0 ||
        preview.skippedEmpty > 0 ||
        preview.unmappedColumns.length > 0) && (
        <ul className="space-y-0.5 border-t pt-3 text-xs text-muted-foreground">
          {preview.newModules > 0 && (
            <li>
              {preview.newModules} module
              {preview.newModules === 1 ? "" : "s"} will be created
            </li>
          )}
          {preview.duplicatesInFile > 0 && (
            <li>
              {preview.duplicatesInFile} row
              {preview.duplicatesInFile === 1 ? "" : "s"} repeat a TC ID within
              the file — the first is kept
            </li>
          )}
          {preview.skippedEmpty > 0 && (
            <li>{preview.skippedEmpty} empty rows will be skipped</li>
          )}
          {preview.unmappedColumns.length > 0 && (
            <li>
              Ignored columns: {preview.unmappedColumns.join(", ")}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ImportSummaryView({ summary }: { summary: ImportSummary }) {
  const imported = summary.created + summary.updated;

  const counts = [
    { label: "Rows read", value: summary.rowsRead },
    { label: "Created", value: summary.created },
    { label: "Updated", value: summary.updated },
    { label: "Empty rows skipped", value: summary.skippedEmpty },
  ];

  return (
    <div className="space-y-4">
      <Alert variant={imported > 0 ? "default" : "destructive"}>
        {imported > 0 ? (
          <CheckCircle2 className="size-4" />
        ) : (
          <AlertTriangle className="size-4" />
        )}
        <AlertDescription>
          {imported > 0
            ? `Imported ${summary.created} new and updated ${summary.updated} test cases from “${summary.sheetName}”.`
            : `Nothing was imported from “${summary.sheetName}”. Check the notes below.`}
        </AlertDescription>
      </Alert>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map((item) => (
          <div key={item.label} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>

      {summary.modulesCreated.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">
            Modules created ({summary.modulesCreated.length})
          </p>
          <p className="text-sm text-muted-foreground">
            {summary.modulesCreated.join(", ")}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Columns matched</p>
        {Object.keys(summary.mappedColumns).length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {Object.entries(summary.mappedColumns).map(([header, field]) => (
              <li key={header}>
                <span className="font-medium text-foreground">{header}</span>
                {" → "}
                {field}
              </li>
            ))}
          </ul>
        )}
      </div>

      {summary.unmappedColumns.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Columns ignored</p>
          <p className="text-sm text-muted-foreground">
            {summary.unmappedColumns.join(", ")}
          </p>
        </div>
      )}

      {summary.errors.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">
            Notes and skipped rows ({summary.errors.length})
          </p>
          <div className="max-h-56 overflow-y-auto rounded-lg border">
            <ul className="divide-y text-sm">
              {summary.errors.map((issue, index) => (
                <li
                  key={`${issue.row}-${index}`}
                  className="flex gap-3 px-3 py-2"
                >
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    Row {issue.row}
                  </span>
                  <span className="min-w-0 text-muted-foreground">
                    {issue.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
