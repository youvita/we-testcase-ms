"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Unplug } from "lucide-react";
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
import { PasswordInput } from "@/components/ui/password-input";
import type { ClaudeConnectionStatus } from "@wetestcase/dto";
import { api, errorMessage } from "@/utils/api-client";
import { formatDate } from "@/utils/format";

/**
 * Connect, replace or disconnect the person's own Claude subscription.
 *
 * AI features run on it and nothing else, so this is where anyone lands when
 * an AI action answers "connect your subscription first".
 */
export function ClaudeConnectionDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful connect — e.g. to retry the action that needed it. */
  onConnected?: () => void;
}) {
  const [status, setStatus] = useState<ClaudeConnectionStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setToken("");
    setStatus(null);
    api
      .get<ClaudeConnectionStatus>("/api/me/claude")
      .then(setStatus)
      .catch((error) => toast.error(errorMessage(error)));
  }, [open]);

  async function handleConnect() {
    setBusy(true);
    try {
      setStatus(
        await api.post<ClaudeConnectionStatus>("/api/me/claude", { token }),
      );
      setToken("");
      toast.success("Claude subscription connected");
      onConnected?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      setStatus(await api.delete<ClaudeConnectionStatus>("/api/me/claude"));
      toast.success("Claude subscription disconnected");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Claude subscription</DialogTitle>
          <DialogDescription>
            AI features — reading PRDs and drafting test cases — run on your own
            Claude Pro or Max plan. Nobody else&apos;s work uses it.
          </DialogDescription>
        </DialogHeader>

        {!status ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !status.aiConfigured ? (
          <Alert>
            <AlertDescription>
              AI is not set up on this server yet. An admin needs to start the
              Claude bridge and set <code>CLAUDE_BRIDGE_URL</code>.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {status.connected && (
              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-status-passed" />
                  Connected · token ending{" "}
                  <span className="font-mono">{status.tokenHint}</span>
                  {status.connectedAt && (
                    <span className="text-muted-foreground">
                      since {formatDate(status.connectedAt)}
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleDisconnect()}
                >
                  <Unplug className="mr-2 size-4" />
                  Disconnect
                </Button>
              </div>
            )}

            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                If your terminal says{" "}
                <span className="font-mono">command not found: claude</span>,
                install the Claude CLI first:{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                  npm install -g @anthropic-ai/claude-code
                </code>
              </li>
              <li>
                Run{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                  claude setup-token
                </code>{" "}
                and sign in with the Claude account that has your Pro or Max
                plan.
              </li>
              <li>
                Paste the token it prints (it starts with{" "}
                <span className="font-mono">sk-ant-oat</span>) below.
              </li>
            </ol>

            <div className="space-y-2">
              <Label htmlFor="claude-token">
                {status.connected ? "Replace with a new token" : "Subscription token"}
              </Label>
              <PasswordInput
                id="claude-token"
                autoComplete="off"
                placeholder="sk-ant-oat…"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Stored encrypted on this server and never shown again. API keys
                are not accepted.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {status?.aiConfigured && (
            <Button
              disabled={busy || token.trim().length < 20}
              onClick={() => void handleConnect()}
            >
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              {busy ? "Checking…" : "Connect"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
