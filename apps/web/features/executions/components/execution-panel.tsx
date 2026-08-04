"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ImagePlus,
  Loader2,
  Send,
  Undo2,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { ExecutionStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_UPLOAD_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  EXECUTION_STATUSES,
  EXECUTION_STATUS_LABELS,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  isVideoMimeType,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/utils/api-client";
import { formatBytes, formatDateTime } from "@/utils/format";
import type { ExecutionWithDetails } from "@/types";

import {
  EXECUTION_PANEL_ANCHOR,
  useExecutionEditor,
} from "./execution-editor-context";

const STATUS_BUTTON_STYLES: Record<ExecutionStatus, string> = {
  PASSED:
    "data-[selected=true]:border-status-passed data-[selected=true]:bg-status-passed/10 data-[selected=true]:text-status-passed",
  FAILED:
    "data-[selected=true]:border-status-failed data-[selected=true]:bg-status-failed/10 data-[selected=true]:text-status-failed",
  BLOCKED:
    "data-[selected=true]:border-status-blocked data-[selected=true]:bg-status-blocked/10 data-[selected=true]:text-status-blocked",
  NOT_RUN:
    "data-[selected=true]:border-muted-foreground data-[selected=true]:bg-muted data-[selected=true]:text-foreground",
};

/**
 * Record a result for a test case.
 *
 * Submitting creates the execution first, then uploads any attachments against
 * it — an execution row is the parent of its attachments, so it has to exist
 * before a file can be attached. A failed upload does not discard the recorded
 * result; the user is told which files failed and can retry them.
 */
export function ExecutionPanel({
  testCaseId,
  currentStatus,
}: {
  testCaseId: string;
  currentStatus: ExecutionStatus;
}) {
  const router = useRouter();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const editor = useExecutionEditor();
  const editing = editor?.editing ?? null;
  // The provider owns this: the collapsed button here, an entry clicked in the
  // history, and the sticky header all open the same card.
  const open = editor?.open ?? false;

  const [status, setStatus] = useState<ExecutionStatus>(
    // Default to the case's current state, but never pre-select "Not Run" as an
    // outcome — a tester recording a result almost never means that.
    currentStatus === "NOT_RUN" ? "PASSED" : currentStatus,
  );
  const [actualResult, setActualResult] = useState("");
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [removedAttachments, setRemovedAttachments] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Loading the clicked entry's values during render, rather than from an
  // effect, means the form never paints one frame of the wrong result.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (editing && editing.id !== loadedId) {
    setLoadedId(editing.id);
    setStatus(editing.status);
    setActualResult(editing.actualResult ?? "");
    setComment(editing.comment ?? "");
    setFiles([]);
    setRemovedAttachments([]);
  } else if (!editing && loadedId) {
    setLoadedId(null);
  }

  /** Back to a blank, collapsed form, whichever mode it was in. */
  function reset() {
    setActualResult("");
    setComment("");
    setFiles([]);
    setRemovedAttachments([]);
    setStatus(currentStatus === "NOT_RUN" ? "PASSED" : currentStatus);
    editor?.close();
  }

  function addFiles(incoming: FileList | null, input: HTMLInputElement | null) {
    if (!incoming) return;

    const accepted: File[] = [];
    for (const file of Array.from(incoming)) {
      if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.type as never)) {
        toast.error(
          `${file.name}: images must be PNG, JPEG, GIF or WebP, video MP4, WebM or QuickTime`,
        );
        continue;
      }

      // Videos get their own ceiling — the server applies the same split.
      const video = isVideoMimeType(file.type);
      const limit = video ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
      if (file.size > limit) {
        toast.error(`${file.name}: larger than ${formatBytes(limit)}`);
        continue;
      }
      accepted.push(file);
    }

    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
    if (input) input.value = "";
  }

  async function handleSubmit() {
    if (status === "FAILED" && !actualResult.trim()) {
      toast.error(
        "Describe what actually happened — developers need it to act on a failure",
      );
      return;
    }

    setSubmitting(true);
    try {
      // Editing updates the row in place; recording creates one. Either way the
      // execution has to exist before attachments can hang off it.
      const execution = editing
        ? await api.patch<ExecutionWithDetails>(
            `/api/executions/${editing.id}`,
            { status, actualResult, comment },
          )
        : await api.post<ExecutionWithDetails>(
            `/api/test-cases/${testCaseId}/executions`,
            { status, actualResult, comment },
          );

      // Removals first: if an upload later fails the user still sees the
      // deletions they asked for, rather than a half-applied mixture.
      for (const attachmentId of removedAttachments) {
        try {
          await api.delete(`/api/attachments/${attachmentId}`);
        } catch {
          /* already gone, or someone else removed it */
        }
      }

      const failedUploads: string[] = [];
      for (const file of files) {
        try {
          const form = new FormData();
          form.append("file", file);
          await api.post(`/api/executions/${execution.id}/attachments`, form);
        } catch {
          failedUploads.push(file.name);
        }
      }

      if (failedUploads.length > 0) {
        toast.warning(
          `Result saved, but these attachments failed to upload: ${failedUploads.join(", ")}`,
        );
      } else {
        toast.success(
          editing
            ? `Updated to ${EXECUTION_STATUS_LABELS[status]}`
            : `Recorded as ${EXECUTION_STATUS_LABELS[status]}`,
        );
      }

      // Collapse on success: the result now lives in the history below, and a
      // form still sitting open invites an accidental duplicate submission.
      reset();
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  // Collapsed, this renders nothing: the button that opens it lives in the
  // page header, which stays on screen while a long case scrolls.
  if (!open) return null;

  return (
    <Card
      id={EXECUTION_PANEL_ANCHOR}
      className={editing ? "border-primary" : undefined}
    >
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">
            {editing ? "Edit result" : "Record result"}
          </CardTitle>
          <CardDescription>
            {editing
              ? `Recorded by ${editing.tester.name} on ${formatDateTime(editing.executedAt)}. Saving replaces it and marks the entry as edited.`
              : "Every submission is kept as history — nothing is overwritten."}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-2 -mt-1 size-8 shrink-0"
          disabled={submitting}
          onClick={reset}
          aria-label={
            editing ? "Cancel editing" : "Close the record result form"
          }
        >
          <X className="size-4" />
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Status</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {EXECUTION_STATUSES.map((option) => (
              <button
                key={option}
                type="button"
                data-selected={status === option}
                aria-pressed={status === option}
                onClick={() => setStatus(option)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
                  STATUS_BUTTON_STYLES[option],
                )}
              >
                {EXECUTION_STATUS_LABELS[option]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="actualResult">
            Actual result
            {status === "FAILED" && (
              <span className="text-destructive"> *</span>
            )}
          </Label>
          <Textarea
            id="actualResult"
            rows={4}
            value={actualResult}
            onChange={(event) => setActualResult(event.target.value)}
            placeholder={
              status === "PASSED"
                ? "Matches the expected result."
                : "What actually happened?"
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="comment">Comment</Label>
          <Textarea
            id="comment"
            rows={2}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Environment, build number, anything a developer should know…"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="attachment-images">Attachments</Label>

          <input
            ref={imageInputRef}
            id="attachment-images"
            type="file"
            multiple
            accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
            className="sr-only"
            onChange={(event) =>
              addFiles(event.target.files, imageInputRef.current)
            }
          />
          <input
            ref={videoInputRef}
            id="attachment-videos"
            type="file"
            multiple
            accept={ALLOWED_VIDEO_MIME_TYPES.join(",")}
            className="sr-only"
            onChange={(event) =>
              addFiles(event.target.files, videoInputRef.current)
            }
          />

          {/* Two pickers rather than one: a single input would have to accept
              both, and the OS file dialog then stops filtering usefully. */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus className="mr-2 size-4" />
              Attach images
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => videoInputRef.current?.click()}
            >
              <Video className="mr-2 size-4" />
              Attach video
            </Button>
          </div>

          {/* Already-uploaded files, when editing. Removal is applied on save,
              not on click, so Cancel really does cancel. */}
          {editing && editing.attachments.length > 0 && (
            <ul className="space-y-1.5">
              {editing.attachments.map((attachment) => {
                const removed = removedAttachments.includes(attachment.id);
                return (
                  <li
                    key={attachment.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm",
                      removed && "opacity-50",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {isVideoMimeType(attachment.mimeType) ? (
                        <Video className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ImagePlus className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span
                        className={cn(
                          "min-w-0 truncate",
                          removed && "line-through",
                        )}
                      >
                        {attachment.fileName}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {formatBytes(attachment.fileSize)}
                      <button
                        type="button"
                        onClick={() =>
                          setRemovedAttachments((prev) =>
                            removed
                              ? prev.filter((id) => id !== attachment.id)
                              : [...prev, attachment.id],
                          )
                        }
                        className="rounded-sm hover:text-foreground"
                        aria-label={
                          removed
                            ? `Keep ${attachment.fileName}`
                            : `Remove ${attachment.fileName}`
                        }
                      >
                        {removed ? (
                          <Undo2 className="size-3.5" />
                        ) : (
                          <X className="size-3.5" />
                        )}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {files.length > 0 && (
            <ul className="space-y-1.5 pt-1">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {isVideoMimeType(file.type) ? (
                      <Video className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ImagePlus className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 truncate">{file.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                    <button
                      type="button"
                      onClick={() =>
                        setFiles((prev) => prev.filter((_, i) => i !== index))
                      }
                      className="rounded-sm hover:text-destructive"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            Images (PNG, JPEG, GIF, WebP) up to {formatBytes(MAX_UPLOAD_BYTES)}{" "}
            each; video (MP4, WebM, QuickTime) up to{" "}
            {formatBytes(MAX_VIDEO_UPLOAD_BYTES)} each.
          </p>
        </div>

        <div className="flex gap-2">
          {editing && (
            <Button
              variant="outline"
              disabled={submitting}
              onClick={reset}
            >
              Cancel
            </Button>
          )}
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1"
          >
            {submitting ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Send className="mr-2 size-4" />
            )}
            {editing ? "Save changes" : "Save result"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
