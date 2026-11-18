"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/utils/api-client";

type Status = { available: boolean; connected: boolean; account: string | null };

/** How often, and how long, to look for the Start press after opening the link. */
const POLL_MS = 3000;
const WAIT_MS = 15 * 60 * 1000;

/**
 * Your own Telegram, for notifications as private messages from the bot.
 * Connect opens the bot with a one-time link; pressing Start there connects
 * it, and this notices within a few seconds.
 */
export function TelegramConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const waitUntil = useRef(0);

  useEffect(() => {
    api.get<Status>("/api/me/telegram").then(setStatus).catch(() => setStatus(null));
  }, []);

  // Waiting for the Start press in Telegram.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(async () => {
      try {
        const next = await api.get<Status>("/api/me/telegram");
        setStatus(next);
        if (next.connected) {
          setWaiting(false);
          toast.success(`Telegram connected${next.account ? ` as ${next.account}` : ""}`);
        } else if (Date.now() > waitUntil.current) {
          setWaiting(false);
        }
      } catch {
        // Tried again on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]);

  async function connect() {
    // Opened at once, within the click: a window opened after an await is
    // blocked as a pop-up.
    const tab = window.open("about:blank", "_blank");
    setBusy(true);
    try {
      const { url } = await api.post<{ url: string }>("/api/me/telegram");
      if (tab) tab.location.href = url;
      else window.location.href = url;
      waitUntil.current = Date.now() + WAIT_MS;
      setWaiting(true);
    } catch (error) {
      tab?.close();
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api.delete("/api/me/telegram");
      setStatus((current) => (current ? { ...current, connected: false, account: null } : current));
      toast.success("Telegram disconnected — notifications stay in the app");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  // No bot on this server: nothing to connect to.
  if (!status?.available) return null;

  return (
    <div className="space-y-2">
      <Label>Telegram</Label>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2.5">
        <p className="min-w-0 text-sm">
          {status.connected ? (
            <>
              Connected as <span className="font-medium">{status.account ?? "your Telegram"}</span>
              <span className="block text-xs text-muted-foreground">Your notifications arrive there too.</span>
            </>
          ) : waiting ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Press <span className="font-medium text-foreground">Start</span> in Telegram…
            </span>
          ) : (
            <span className="text-muted-foreground">Get your notifications as messages from the WeTestCase bot.</span>
          )}
        </p>
        {status.connected ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={busy} onClick={() => void connect()}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
            {waiting ? "Open again" : "Connect Telegram"}
          </Button>
        )}
      </div>
    </div>
  );
}
