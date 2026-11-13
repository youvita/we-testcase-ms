"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, CheckCircle2, Copy, Loader2, PlugZap, Unplug } from "lucide-react";
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
import { normalizeToken } from "@/utils/claude-token";
import { formatDate } from "@/utils/format";

type Platform = "mac" | "windows";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "mac";
  return /windows/i.test(navigator.userAgent) ? "windows" : "mac";
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1 py-0.5 font-sans text-[11px] font-medium text-foreground">
      {children}
    </kbd>
  );
}

/**
 * Per system: how to open the terminal, and one command that works whether or
 * not Claude Code is already there. It installs only when `claude` is missing
 * (the official installers), then starts the sign-in. The installer's folder
 * is put first on PATH for that one run, because the terminal that ran the
 * installer has not picked up the new PATH yet — and an install from
 * Homebrew, npm or WinGet is still found behind it. Same as WePlanner's.
 */
const PLATFORM_STEPS: Record<Platform, { label: string; openTerminal: ReactNode; enter: string; command: string }> = {
  mac: {
    label: "Mac",
    openTerminal: (
      <>
        Press <Kbd>⌘ Command</Kbd> + <Kbd>Space</Kbd>, type <strong className="text-foreground">Terminal</strong>,
        and press <Kbd>Return</Kbd>.
      </>
    ),
    enter: "Return",
    command:
      'command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash; PATH="$HOME/.local/bin:$PATH" claude setup-token',
  },
  windows: {
    label: "Windows",
    openTerminal: (
      <>
        Press the <Kbd>Windows</Kbd> key, type <strong className="text-foreground">PowerShell</strong>, and press{" "}
        <Kbd>Enter</Kbd>.
      </>
    ),
    enter: "Enter",
    command:
      'if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { irm https://claude.ai/install.ps1 | iex }; $env:Path = "$env:USERPROFILE\\.local\\bin;$env:Path"; claude setup-token',
  },
};

/** A command with a Copy button — the one thing on this dialog that must be exact. */
function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-muted/60 px-3 py-2">
      <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed text-foreground">{command}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        aria-label="Copy command"
      >
        {copied ? <Check className="size-3.5 text-status-passed" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

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
  const [platform, setPlatform] = useState<Platform>("mac");
  // After mount, so the server render and the first client render agree.
  useEffect(() => setPlatform(detectPlatform()), []);

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
          <DialogTitle>
            {status?.connected ? "Claude subscription" : "Connect your Claude subscription"}
          </DialogTitle>
          <DialogDescription>
            AI features run on your own Claude Pro or Max plan. The token is
            stored encrypted on this server and used only for your own requests.
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
                  Connected
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

            {/* Detected, but switchable: someone may be reading this on one
                machine and setting up on another. */}
            <div className="inline-flex w-fit rounded-lg border bg-muted/50 p-0.5">
              {(Object.keys(PLATFORM_STEPS) as Platform[]).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => setPlatform(entry)}
                  aria-pressed={platform === entry}
                  className={
                    platform === entry
                      ? "rounded-md bg-background px-3 py-1 text-xs font-medium text-foreground shadow-sm"
                      : "rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  }
                >
                  {PLATFORM_STEPS[entry].label}
                </button>
              ))}
            </div>

            <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-muted-foreground">
              <li>{PLATFORM_STEPS[platform].openTerminal}</li>
              {/* Not `flex` on the <li> itself: that drops its list number. */}
              <li>
                <div className="flex flex-col gap-1.5">
                  <span>
                    Copy this, paste it into the window that opened, and press{" "}
                    <Kbd>{PLATFORM_STEPS[platform].enter}</Kbd>. It installs Claude
                    Code if you don&apos;t have it yet.
                  </span>
                  <CopyCommand command={PLATFORM_STEPS[platform].command} />
                </div>
              </li>
              <li>
                Your browser opens Claude&apos;s sign-in page. Sign in with your
                Claude Pro or Max account and approve.
              </li>
              <li>
                Back in the terminal, copy everything it printed and paste it
                below — the token is picked out automatically.
              </li>
            </ol>

            <div className="space-y-2">
              <Label htmlFor="claude-token">
                {status.connected ? "Replace with a new token" : "Token"}
              </Label>
              <PasswordInput
                id="claude-token"
                autoComplete="off"
                placeholder="Paste the token (sk-ant-oat01-…) here"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                onPaste={(event) => {
                  // Cleaned here, while the pasted text still has its line
                  // breaks: a one-line field drops them on its own, and a
                  // token wrapped in a terminal would come out with spaces
                  // in the middle and the surrounding text attached.
                  const pasted = event.clipboardData.getData("text");
                  if (!pasted.includes("sk-ant-")) return;
                  event.preventDefault();
                  setToken(normalizeToken(pasted));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !busy && token.trim().length >= 20) void handleConnect();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Pasting the whole terminal output is fine — wrapped lines and
                the text around the token are removed for you. Never shown
                again. API keys are not accepted.
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
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <PlugZap className="mr-2 size-4" />}
              {busy ? "Checking…" : "Verify & save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
