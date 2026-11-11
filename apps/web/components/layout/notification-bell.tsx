"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CornerDownRight, MessageCircleQuestion, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api-client";
import { formatRelative } from "@/utils/format";
import type { NotificationDto, NotificationList } from "@wetestcase/dto";

const VERB: Record<NotificationDto["kind"], string> = {
  QUESTION_ASKED: "asked you about",
  QUESTION_ANSWERED: "answered your question on",
  QUESTION_REPLIED: "followed up on",
  COMMENT_REPLIED: "replied on",
  COMMENT_POSTED: "commented on",
};

/** How often the bell looks for new notifications while the page is open. */
const POLL_MS = 60_000;

/**
 * Questions for the PO, and their answers, for the signed-in person. Checked
 * every minute and whenever the tab comes back into focus.
 */
export function NotificationBell() {
  const router = useRouter();
  const [list, setList] = useState<NotificationList>({ items: [], unread: 0 });
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await api.get<NotificationList>("/api/notifications"));
    } catch {
      // A missed check is retried on the next one.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function markRead(ids?: string[]) {
    const now = new Date().toISOString();
    setList((current) => ({
      unread: ids ? current.items.filter((n) => !n.readAt && !ids.includes(n.id)).length : 0,
      items: current.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)),
    }));
    try {
      await api.post("/api/notifications/read", ids ? { ids } : {});
    } catch {
      void load();
    }
  }

  function openCase(notification: NotificationDto) {
    if (!notification.readAt) void markRead([notification.id]);
    setOpen(false);
    router.push(notification.href);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={list.unread ? `Notifications, ${list.unread} unread` : "Notifications"}
        >
          <Bell className="size-5" />
          {list.unread > 0 && (
            <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
              {list.unread > 9 ? "9+" : list.unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-sm font-medium">Notifications</p>
          {list.unread > 0 && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void markRead()}>
              Mark all read
            </Button>
          )}
        </div>
        {list.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing yet. Questions for the PO, and their answers, show up here.
          </p>
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {list.items.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/60",
                    !notification.readAt && "bg-primary/5",
                  )}
                  onClick={() => openCase(notification)}
                >
                  {notification.kind === "COMMENT_REPLIED" || notification.kind === "COMMENT_POSTED" ? (
                    <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : notification.kind !== "QUESTION_ANSWERED" ? (
                    <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-status-blocked" aria-hidden />
                  ) : (
                    <CornerDownRight className="mt-0.5 size-4 shrink-0 text-status-passed" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block">
                      <span className="font-medium">{notification.actor.name}</span>{" "}
                      {VERB[notification.kind]}{" "}
                      <span className="font-medium">{notification.subject}</span>
                    </span>
                    <span className="block truncate text-muted-foreground">{notification.excerpt}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatRelative(notification.createdAt)}
                    </span>
                  </span>
                  {!notification.readAt && (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
