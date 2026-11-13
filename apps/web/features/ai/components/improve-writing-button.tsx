"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError, api, errorMessage } from "@/utils/api-client";

import { ClaudeConnectionDialog } from "./claude-connection-dialog";

/**
 * "Improve writing" beside a comment, question or reply box: the AI fixes
 * spelling and grammar and makes it read clearly, and the result replaces
 * the text in the box — with an Undo, since it is the person's words.
 * Nothing is posted; they still read it and post it themselves.
 */
export function ImproveWritingButton({
  text,
  onChange,
  disabled,
  onBusyChange,
  compact = false,
}: {
  text: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  /** So the box can lock while its text is being rewritten. */
  onBusyChange?: (busy: boolean) => void;
  /** Icon only, for a narrow reply box. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  async function improve() {
    const original = text;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const result = await api.post<{ text: string }>("/api/ai/improve-writing", { text: original });
      if (result.text.trim() === original.trim()) {
        toast.message("Nothing to change — it reads fine.");
        return;
      }
      onChange(result.text);
      toast.success("Writing improved", {
        action: { label: "Undo", onClick: () => onChange(original) },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) setConnectOpen(true);
      else toast.error(errorMessage(error));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-muted-foreground"
        disabled={disabled || busy || !text.trim()}
        onClick={() => void improve()}
        title="Improve writing — fix spelling and grammar, and make it read clearly"
        aria-label={compact ? "Improve writing" : undefined}
      >
        {busy ? (
          <Loader2 className={compact ? "size-4 animate-spin" : "mr-1.5 size-4 animate-spin"} />
        ) : (
          <Sparkles className={compact ? "size-4" : "mr-1.5 size-4"} />
        )}
        {!compact && (busy ? "Improving…" : "Improve writing")}
      </Button>
      <ClaudeConnectionDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={() => void improve()}
      />
    </>
  );
}
