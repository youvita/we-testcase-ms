"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { CornerDownRight, Loader2, X } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ImproveWritingButton } from "@/features/ai/components/improve-writing-button";
import { useSession } from "@/lib/auth-client";
import { initials } from "@/utils/format";

import { AttachButton, PendingFiles, addFiles, pastedFiles } from "./comment-files";

/** Tall enough for a few lines; past that the box scrolls. */
const MAX_HEIGHT = 160;

/**
 * Replying under a comment or question, chat-style: a "Reply to …" bar with a
 * ✕ to give up, then the replier's avatar beside one box that grows as they
 * type, with Improve writing and Attach inside it. Enter sends, Shift+Enter is
 * a new line, Esc cancels — no Send/Cancel buttons; the placeholder says so.
 *
 * Files are optional: pass `files` and `onFilesChange` where a reply can carry
 * them (a case's discussion), leave them out where it is text only.
 */
export function ReplyBox({
  value,
  onChange,
  onSend,
  onCancel,
  sending,
  replyTo,
  ariaLabel,
  files,
  onFilesChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  sending: boolean;
  /** Whose message this answers, for the bar above the box. */
  replyTo: string;
  ariaLabel: string;
  files?: File[];
  onFilesChange?: (files: File[]) => void;
}) {
  const [improving, setImproving] = useState(false);
  const me = useSession().data?.user;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const withFiles = files !== undefined && onFilesChange !== undefined;
  const canSend = !sending && !improving && (value.trim().length > 0 || (withFiles && files.length > 0));
  const locked = sending || improving;

  // One line to start, growing with the text up to MAX_HEIGHT.
  useLayoutEffect(() => {
    const box = textareaRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, MAX_HEIGHT)}px`;
    box.style.overflowY = box.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [value]);

  // Back to the box after the AI rewrote it (it was disabled meanwhile).
  useLayoutEffect(() => {
    if (!locked) textareaRef.current?.focus();
  }, [locked]);

  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <CornerDownRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">Reply to {replyTo}</span>
        </p>
        <button
          type="button"
          onClick={onCancel}
          disabled={sending}
          title="Cancel (Esc)"
          aria-label="Cancel reply"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex items-start gap-2.5">
        <Avatar className="mt-0.5 size-8 shrink-0">
          {me?.image && <AvatarImage src={me.image} alt="" />}
          <AvatarFallback className="text-xs">{me ? initials(me.name) : ""}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-end gap-1 rounded-md border border-input bg-background py-1 pl-3 pr-1 shadow-sm focus-within:ring-1 focus-within:ring-ring">
            <textarea
              ref={textareaRef}
              rows={1}
              autoFocus
              value={value}
              disabled={locked}
              onChange={(event) => onChange(event.target.value)}
              onPaste={
                withFiles
                  ? (event) => {
                      const pasted = pastedFiles(event);
                      if (pasted.length) onFilesChange(addFiles(files, pasted));
                    }
                  : undefined
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (canSend) onSend();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  if (!sending) onCancel();
                }
              }}
              // The keys are the buttons, so the box itself says how to use them.
              placeholder="Enter to send · Shift+Enter new line"
              aria-label={ariaLabel}
              className="min-w-0 flex-1 resize-none self-center bg-transparent py-1.5 text-base placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
            />
            {sending ? (
              <span className="flex h-8 items-center gap-1 px-2 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Sending…
              </span>
            ) : (
              <div className="flex shrink-0 items-center">
                <ImproveWritingButton compact text={value} onChange={onChange} onBusyChange={setImproving} />
                {withFiles && <AttachButton compact files={files} onChange={onFilesChange} disabled={improving} />}
              </div>
            )}
          </div>
          {withFiles && <PendingFiles files={files} onChange={onFilesChange} disabled={sending} />}
        </div>
      </div>
    </div>
  );
}
