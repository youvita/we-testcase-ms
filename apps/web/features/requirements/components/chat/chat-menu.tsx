"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronLeft, SlidersHorizontal } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { AiChatEffort, AiModel } from "@wetestcase/dto";

import type { ChatSettings } from "./chat-store";

/**
 * The composer's settings menu, laid out as WePlanner's (after Claude
 * Code's): Context, Model with effort and thinking, the session's usage,
 * and the Claude subscription.
 */

export const MODELS: { id: AiModel; label: string }[] = [
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
];

type View = "root" | "mention" | "rewind";

function Heading({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">{children}</p>;
}

function Item({
  onClick,
  disabled,
  children,
  right,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
    >
      <span className="min-w-0">{children}</span>
      {right && <span className="flex shrink-0 items-center text-muted-foreground">{right}</span>}
    </button>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-3" /> Back
    </button>
  );
}

export function ChatMenu({
  settings,
  onSettingsChange,
  onAttach,
  attachDisabled,
  docs,
  onMention,
  onClear,
  clearDisabled,
  rewindTargets,
  onRewind,
  usage,
  connected,
  onSubscription,
}: {
  settings: ChatSettings;
  onSettingsChange: (settings: ChatSettings) => void;
  onAttach: () => void;
  attachDisabled?: boolean;
  /** The project's documents that can go with a question in full. */
  docs: { id: string; title: string }[];
  onMention: (doc: { id: string; title: string }) => void;
  onClear: () => void;
  clearDisabled?: boolean;
  /** Earlier questions, oldest first; picking one rewinds to before it. */
  rewindTargets: { index: number; text: string }[];
  onRewind: (index: number) => void;
  usage: { turns: number; tokens: number };
  connected: boolean | null;
  onSubscription: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("root");
  const close = () => setOpen(false);
  const set = (patch: Partial<ChatSettings>) => onSettingsChange({ ...settings, ...patch });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setView("root");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Model: ${MODELS.find((entry) => entry.id === settings.model)?.label ?? settings.model}`}
          aria-label="Model and chat settings"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <SlidersHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-0 py-1">
        {view === "root" && (
          <>
            <Heading>Context</Heading>
            <Item
              disabled={attachDisabled}
              onClick={() => {
                close();
                onAttach();
              }}
            >
              Attach file…
            </Item>
            <Item disabled={docs.length === 0} onClick={() => setView("mention")}>
              Mention document from this project…
            </Item>
            <Item
              disabled={clearDisabled}
              onClick={() => {
                close();
                onClear();
              }}
            >
              Clear conversation
            </Item>
            <Item disabled={rewindTargets.length === 0} onClick={() => setView("rewind")}>
              Rewind
            </Item>

            <div className="my-1 h-px bg-border" />
            <Heading>Model</Heading>
            {MODELS.map((entry) => (
              <Item
                key={entry.id}
                onClick={() => set({ model: entry.id })}
                right={entry.id === settings.model ? <Check className="size-3.5" /> : undefined}
              >
                {entry.label}
              </Item>
            ))}
            <div className="flex items-center justify-between px-3 py-1.5 text-xs">
              <span>Effort</span>
              <span className="flex overflow-hidden rounded-md border">
                {(["low", "medium", "high"] as AiChatEffort[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => set({ effort: level })}
                    className={cn(
                      "px-2 py-0.5 text-[11px] capitalize",
                      level === settings.effort ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                    )}
                  >
                    {level}
                  </button>
                ))}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5 text-xs">
              <span>Thinking</span>
              <button
                type="button"
                role="switch"
                aria-checked={settings.thinking}
                aria-label="Thinking"
                onClick={() => set({ thinking: !settings.thinking })}
                className={cn(
                  "relative h-5 w-9 rounded-full transition-colors",
                  settings.thinking ? "bg-primary" : "bg-muted-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-background shadow transition-all",
                    settings.thinking ? "left-[18px]" : "left-0.5",
                  )}
                />
              </button>
            </div>

            <div className="my-1 h-px bg-border" />
            <div className="flex justify-between px-3 py-1.5 text-[11px] text-muted-foreground">
              <span>This session</span>
              <span>
                {usage.turns} turn{usage.turns === 1 ? "" : "s"} · {usage.tokens.toLocaleString()} token
                {usage.tokens === 1 ? "" : "s"}
              </span>
            </div>
            <Item
              onClick={() => {
                close();
                onSubscription();
              }}
              right={
                <span
                  className={cn(
                    "size-2 rounded-full",
                    connected ? "bg-emerald-500" : "bg-muted-foreground/50",
                  )}
                />
              }
            >
              Claude subscription…
            </Item>
          </>
        )}

        {view === "mention" && (
          <>
            <Back onClick={() => setView("root")} />
            <Heading>Documents in this project</Heading>
            <div className="max-h-56 overflow-y-auto">
              {docs.map((doc) => (
                <Item
                  key={doc.id}
                  onClick={() => {
                    close();
                    onMention(doc);
                  }}
                >
                  <span className="line-clamp-2">{doc.title}</span>
                </Item>
              ))}
            </div>
            <p className="px-3 py-1.5 text-[11px] text-muted-foreground">
              Its full text goes with your next question.
            </p>
          </>
        )}

        {view === "rewind" && (
          <>
            <Back onClick={() => setView("root")} />
            <Heading>Rewind to before…</Heading>
            <div className="max-h-56 overflow-y-auto">
              {[...rewindTargets].reverse().map((target) => (
                <Item
                  key={target.index}
                  onClick={() => {
                    close();
                    onRewind(target.index);
                  }}
                >
                  <span className="line-clamp-2">{target.text}</span>
                </Item>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
