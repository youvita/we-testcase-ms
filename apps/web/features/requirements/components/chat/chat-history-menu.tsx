"use client";

import { useState } from "react";
import { History, MessageSquare, Trash2 } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { loadHistory, type PastChat } from "./chat-store";

/** Past conversations of this project's chat, opened from the clock in the header. */
export function ChatHistoryMenu({
  projectId,
  disabled,
  onOpenChat,
  onDeleteChat,
}: {
  projectId: string;
  /** While a reply is streaming — switching then would lose it. */
  disabled?: boolean;
  onOpenChat: (chat: PastChat) => void;
  onDeleteChat: (id: string) => PastChat[];
}) {
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<PastChat[]>([]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setChats(loadHistory(projectId));
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="Past chats"
          aria-label="Past chats"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <History className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0 py-1">
        <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">Past chats</p>
        {chats.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No past chats yet. A new chat keeps the current one here.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {chats.map((chat) => (
              <div key={chat.id} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-accent">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpenChat(chat);
                  }}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="line-clamp-1 text-xs">{chat.title}</span>
                    <span className="text-[11px] text-muted-foreground">{chat.updatedAt}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setChats(onDeleteChat(chat.id))}
                  aria-label={`Delete "${chat.title}"`}
                  className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
