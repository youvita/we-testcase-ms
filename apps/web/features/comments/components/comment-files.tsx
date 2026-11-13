"use client";

import { useRef, type ClipboardEvent } from "react";
import { Paperclip, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { MAX_COMMENT_FILES } from "@/lib/constants";
import { formatBytes } from "@/utils/format";

const ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".doc",
  ".xls",
  ".zip",
  ".txt",
  ".log",
  ".md",
  ".csv",
  ".json",
].join(",");

/** Add files to those chosen, up to the limit, without the same one twice. */
export function addFiles(current: File[], incoming: File[]): File[] {
  const key = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
  const seen = new Set(current.map(key));
  const next = [...current, ...incoming.filter((file) => !seen.has(key(file)))];
  if (next.length > MAX_COMMENT_FILES) {
    toast.error(`Attach at most ${MAX_COMMENT_FILES} files to one comment`);
    return next.slice(0, MAX_COMMENT_FILES);
  }
  return next;
}

/**
 * Files pasted into a comment box — a screenshot straight from the clipboard.
 * Plain text pastes as usual.
 */
export function pastedFiles(event: ClipboardEvent): File[] {
  const files = [...event.clipboardData.files];
  if (files.length === 0) return [];
  event.preventDefault();
  // A pasted screenshot is called "image.png"; give it a name worth keeping.
  return files.map((file) =>
    file.name === "image.png"
      ? new File([file], `screenshot-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.png`, {
          type: file.type,
        })
      : file,
  );
}

/** The body to post: JSON, or multipart when files go with it. */
export function commentPayload(
  body: string,
  files: File[],
  { replyToId, question }: { replyToId?: string; question?: boolean } = {},
) {
  if (files.length === 0) {
    return { body, ...(replyToId ? { replyToId } : {}), ...(question ? { question } : {}) };
  }
  const form = new FormData();
  form.set("body", body);
  if (replyToId) form.set("replyToId", replyToId);
  if (question) form.set("question", "true");
  for (const file of files) form.append("files", file);
  return form;
}

/** The paperclip: choose files to post with a comment. */
export function AttachButton({
  files,
  onChange,
  disabled,
  compact = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  /** Icon only, for a narrow reply box. */
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => {
          onChange(addFiles(files, [...(event.target.files ?? [])]));
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-muted-foreground"
        disabled={disabled || files.length >= MAX_COMMENT_FILES}
        onClick={() => input.current?.click()}
        title="Attach — images, video, PDF, Office files, zip, text or logs, or paste a screenshot"
        aria-label={compact ? "Attach files" : undefined}
      >
        <Paperclip className={compact ? "size-4" : "mr-1.5 size-4"} />
        {!compact && "Attach"}
      </Button>
    </>
  );
}

/** The files chosen so far, each with a way to take it off. */
export function PendingFiles({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {files.map((file, index) => (
        <li
          key={`${file.name}:${file.size}:${file.lastModified}`}
          className="flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 py-0.5 pl-2 pr-0.5 text-xs"
        >
          <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate">{file.name}</span>
          <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
            disabled={disabled}
            aria-label={`Remove ${file.name}`}
            onClick={() => onChange(files.filter((_, i) => i !== index))}
          >
            <X className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}
