"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowUp,
  CircleHelp,
  CircleStop,
  ClipboardCheck,
  Eye,
  FileSearch,
  FileText,
  GitCompare,
  ListChecks,
  Loader2,
  Paperclip,
  Plus,
  SquarePen,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { withBasePath } from "@/lib/base-path";
import { api } from "@/utils/api-client";
import type {
  AiChatAttachment,
  AiChatEvent,
  AiChatInput,
  ClaudeConnectionStatus,
  RequirementDto,
} from "@wetestcase/dto";

import { ChatHistoryMenu } from "./chat/chat-history-menu";
import { ChatMarkdown } from "./chat/chat-markdown";
import { ChatMenu } from "./chat/chat-menu";
import {
  DEFAULT_SETTINGS,
  loadCurrent,
  loadHistory,
  loadSettings,
  saveCurrent,
  saveHistory,
  saveSettings,
  toHistory,
  toPastChat,
  type ChatSettings,
  type ChatTurn,
  type PastChat,
} from "./chat/chat-store";

type Tab = "requirements" | "drafts";

const SUGGESTIONS: Record<Tab, { icon: LucideIcon; text: string }[]> = {
  requirements: [
    { icon: ClipboardCheck, text: "Which requirements are not ready to verify yet, and why?" },
    { icon: CircleHelp, text: "List the open questions to ask the PO, grouped by section." },
    { icon: FileSearch, text: "Which requirements have no test case yet?" },
    { icon: GitCompare, text: "Do any requirements contradict each other?" },
  ],
  drafts: [
    { icon: ClipboardCheck, text: "Which drafts cannot be accepted yet, and what is blocking them?" },
    { icon: CircleHelp, text: "Which drafts still have open questions?" },
    { icon: GitCompare, text: "Are any drafts duplicates of each other or of existing test cases?" },
    { icon: ListChecks, text: "Which drafts miss part of their requirement's acceptance criteria?" },
  ],
};

const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 40_000;
const MAX_COMPOSER_HEIGHT = 200;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
const TEXT_EXTENSIONS = /\.(txt|md|csv|tsv|json|log|xml|html?|ya?ml)$/i;

type Pending = AiChatAttachment & { sizeKb: number };
type Doc = { id: string; title: string };

function fileSize(kb: number) {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
}

async function toAttachment(file: File): Promise<Pending | string> {
  const sizeKb = file.size / 1024;
  if ((IMAGE_TYPES as readonly string[]).includes(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) return `${file.name} is over 2 MB.`;
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return {
      kind: "image",
      name: file.name,
      mediaType: file.type as (typeof IMAGE_TYPES)[number],
      data: url.slice(url.indexOf(",") + 1),
      sizeKb,
    };
  }
  if (file.type.startsWith("text/") || TEXT_EXTENSIONS.test(file.name)) {
    const text = await file.text();
    return {
      kind: "text",
      name: file.name,
      text: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…(cut)` : text,
      sizeKb,
    };
  }
  return `${file.name}: attach an image or a text file. Upload PDFs and Word files on the Documents tab.`;
}

/**
 * Ask the AI about the project's requirements and drafts — laid out as
 * WePlanner's AI chat.
 *
 * Non-modal, so the page stays usable beside it: a [code] in an answer
 * jumps to that requirement. Threads are kept in this browser, per project.
 */
export function RequirementsChat({
  projectId,
  projectName,
  tab,
  open,
  onOpenChange,
  requirements,
  draftCount,
  docs,
  onFocusRequirement,
  onConnect,
}: {
  projectId: string;
  projectName: string;
  tab: Tab;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requirements: RequirementDto[];
  draftCount: number;
  docs: Doc[];
  onFocusRequirement: (id: string) => void;
  /** Open the connect dialog; `after` runs once connected. */
  onConnect: (after: () => void) => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_SETTINGS);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Pending[]>([]);
  const [mentions, setMentions] = useState<Doc[]>([]);
  const [pending, setPending] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState({ turns: 0, tokens: 0 });
  const [connected, setConnected] = useState<boolean | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Browser storage only exists after mount.
  useEffect(() => {
    setTurns(loadCurrent(projectId));
    setSettings(loadSettings());
    setHydrated(true);
  }, [projectId]);
  useEffect(() => {
    if (hydrated) saveCurrent(projectId, turns);
  }, [hydrated, projectId, turns]);

  const refreshConnection = useCallback(() => {
    api
      .get<ClaudeConnectionStatus>("/api/me/claude")
      .then((status) => setConnected(status.connected))
      .catch(() => setConnected(null));
  }, []);
  useEffect(() => {
    if (open) refreshConnection();
  }, [open, refreshConnection]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Beside the page rather than over it, as in WePlanner: on a wide screen
  // the page makes room, so the rows a reply points at stay in view.
  useEffect(() => {
    if (!open) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const root = document.documentElement;
    const apply = () => {
      root.style.paddingRight = wide.matches ? "28rem" : "";
    };
    apply();
    wide.addEventListener("change", apply);
    return () => {
      wide.removeEventListener("change", apply);
      root.style.paddingRight = "";
    };
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streamText, pending, open]);

  useEffect(() => {
    if (!pending) return;
    setElapsed(0);
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [input, open]);

  // A code may repeat across documents; the active one wins.
  const idByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const req of requirements) {
      if (!map.has(req.code) || req.status === "ACTIVE") map.set(req.code, req.id);
    }
    return map;
  }, [requirements]);

  const activeCount = requirements.filter((req) => req.status === "ACTIVE").length;

  function changeSettings(next: ChatSettings) {
    setSettings(next);
    saveSettings(next);
  }

  async function run(before: ChatTurn[], payload: AiChatInput, shown: ChatTurn) {
    setTurns([...before, shown]);
    setPending(true);
    setStreamText("");
    stoppedRef.current = false;
    const abort = new AbortController();
    abortRef.current = abort;

    let text = "";
    let failure: string | null = null;
    try {
      const response = await fetch(withBasePath(`/api/projects/${projectId}/ai-chat`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (response.status === 412) {
          // Not connected: take the question back, connect, then ask it.
          setTurns(before);
          setPending(false);
          onConnect(() => {
            refreshConnection();
            void run(before, payload, shown);
          });
          return;
        }
        failure = body?.error ?? `Request failed with status ${response.status}`;
      } else {
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let end: number;
          while ((end = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, end).trim();
            buffer = buffer.slice(end + 1);
            if (!line) continue;
            let event: AiChatEvent;
            try {
              event = JSON.parse(line) as AiChatEvent;
            } catch {
              continue;
            }
            if (event.type === "text") {
              text += event.text;
              setStreamText(text);
            } else if (event.type === "usage") {
              setUsage((current) => ({
                turns: current.turns + 1,
                tokens: current.tokens + event.inputTokens + event.outputTokens,
              }));
            } else if (event.type === "error") {
              failure = event.message;
            }
          }
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) failure = error instanceof Error ? error.message : "Could not reach the server.";
    }

    const stopped = stoppedRef.current;
    if (abortRef.current === abort) abortRef.current = null;
    // Closed or left the page mid-answer: keep what came.
    const reply: ChatTurn[] = [];
    if (text.trim()) reply.push({ role: "assistant", text, ...(stopped ? { interrupted: true } : {}) });
    if (failure) reply.push({ role: "assistant", text: failure, error: true });
    setTurns([...before, shown, ...reply]);
    setStreamText("");
    setPending(false);
  }

  function send() {
    if (pending) return;
    const typed = input.trim();
    if (!typed && attachments.length === 0) return;
    const question =
      typed || (attachments.length === 1 ? "Look at the attached file." : "Look at the attached files.");
    const files = [...mentions.map((doc) => doc.title), ...attachments.map((file) => file.name)];
    const payload: AiChatInput = {
      messages: [...toHistory(turns), { role: "user", content: question }],
      attachments: attachments.map(({ sizeKb: _size, ...file }) => file),
      docIds: mentions.map((doc) => doc.id),
      tab,
      model: settings.model,
      effort: settings.effort,
      thinking: settings.thinking,
    };
    setInput("");
    setAttachments([]);
    setMentions([]);
    void run(turns, payload, { role: "user", text: question, ...(files.length ? { files } : {}) });
  }

  function stop() {
    stoppedRef.current = true;
    abortRef.current?.abort();
  }

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    const room = MAX_ATTACHMENTS - attachments.length;
    if (picked.length > room) toast.message(`At most ${MAX_ATTACHMENTS} files per question.`);
    const next: Pending[] = [];
    for (const file of picked.slice(0, room)) {
      const result = await toAttachment(file);
      if (typeof result === "string") toast.error(result);
      else next.push(result);
    }
    if (next.length) setAttachments((current) => [...current, ...next].slice(0, MAX_ATTACHMENTS));
  }

  /** The current thread goes to the top of the history. */
  function keepInHistory(rest: PastChat[]) {
    return turns.length ? [toPastChat(turns), ...rest] : rest;
  }

  function newChat() {
    if (pending) return;
    saveHistory(projectId, keepInHistory(loadHistory(projectId)));
    setTurns([]);
    setUsage({ turns: 0, tokens: 0 });
    setInput("");
    setAttachments([]);
    setMentions([]);
  }

  function openChat(chat: PastChat) {
    if (pending) return;
    const rest = loadHistory(projectId).filter((entry) => entry.id !== chat.id);
    saveHistory(projectId, keepInHistory(rest));
    setTurns(chat.turns);
  }

  function deleteChat(id: string) {
    const rest = loadHistory(projectId).filter((entry) => entry.id !== id);
    saveHistory(projectId, rest);
    return rest;
  }

  function rewindTo(index: number) {
    const restored = turns[index];
    setTurns(turns.slice(0, index));
    if (restored) setInput(restored.text);
    textareaRef.current?.focus();
  }

  const rewindTargets = turns
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn }) => turn.role === "user")
    .map(({ turn, index }) => ({ index, text: turn.text }));

  const sees = [
    `${activeCount} requirement${activeCount === 1 ? "" : "s"}`,
    `${draftCount} draft${draftCount === 1 ? "" : "s"}`,
    "PO questions",
    ...mentions.map((doc) => doc.title),
  ];

  const iconButton =
    "rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40";

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md [&>button:last-child]:hidden"
        // Non-modal: clicking the page (e.g. a requirement) must not close it.
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          // Esc interrupts a reply first, as in WePlanner.
          if (pending) {
            event.preventDefault();
            stop();
          }
        }}
      >
        {/* Header */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
          <SheetTitle className="text-sm font-medium">AI Chat</SheetTitle>
          <SheetDescription className="sr-only">
            Ask about this project&apos;s requirements, PO questions and drafts.
          </SheetDescription>
          <div className="flex items-center gap-1">
            <button type="button" onClick={newChat} disabled={pending} title="New chat" aria-label="New chat" className={iconButton}>
              <SquarePen className="size-4" />
            </button>
            <ChatHistoryMenu projectId={projectId} disabled={pending} onOpenChat={openChat} onDeleteChat={deleteChat} />
            <button type="button" onClick={() => onOpenChange(false)} title="Close" aria-label="Close" className={iconButton}>
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Empty state */}
        {turns.length === 0 && !pending && (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-6">
            <div className="text-center">
              <Sparkles className="mx-auto mb-2 size-5 text-muted-foreground/70" />
              <p className="text-sm font-medium text-muted-foreground">Ask about {projectName}</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Claude answers from this project&apos;s requirements, PO questions and drafts. It reads only, and changes
                nothing.
              </p>
            </div>
            {/* A pick fills the composer rather than sending: it is a start, not the question. */}
            <div className="flex w-full max-w-sm flex-col gap-1.5">
              {SUGGESTIONS[tab].map(({ icon: Icon, text }) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => {
                    setInput(text);
                    textareaRef.current?.focus();
                  }}
                  className="flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs text-foreground/80 transition-colors hover:bg-muted"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span>{text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {(turns.length > 0 || pending) && (
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-3 px-4 pb-3 pt-4">
              {turns.map((turn, index) =>
                turn.role === "user" ? (
                  <div key={index} className="max-w-[85%] self-end">
                    <p className="whitespace-pre-wrap rounded-2xl bg-muted px-3.5 py-2 text-sm">{turn.text}</p>
                    {turn.files?.length ? (
                      <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                        <Paperclip className="size-3" /> {turn.files.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ) : turn.error ? (
                  <p key={index} className="whitespace-pre-wrap text-sm text-destructive">
                    {turn.text}
                  </p>
                ) : turn.interrupted ? (
                  <div key={index} className="flex gap-1.5">
                    <CircleStop className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 opacity-70">
                      <ChatMarkdown text={turn.text} idByCode={idByCode} onCode={onFocusRequirement} />
                    </div>
                  </div>
                ) : (
                  <ChatMarkdown key={index} text={turn.text} idByCode={idByCode} onCode={onFocusRequirement} />
                ),
              )}
              {pending &&
                (streamText ? (
                  <ChatMarkdown text={streamText} idByCode={idByCode} onCode={onFocusRequirement} />
                ) : (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Thinking… <span className="text-xs">esc to interrupt · {elapsed}s</span>
                  </p>
                ))}
            </div>
          </div>
        )}

        {/* Composer */}
        <div className="mt-auto shrink-0 px-4 pb-3 pt-2">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
            <Eye className="size-3 shrink-0" />
            <span className="truncate" title={sees.join(" · ")}>
              Claude sees: {sees.join(" · ")}
            </span>
          </p>
          {connected === false && (
            <button
              type="button"
              onClick={() => onConnect(refreshConnection)}
              className="mb-2 w-full rounded-lg border border-dashed px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
            >
              Connect your Claude subscription to use AI features.
            </button>
          )}
          <div className="rounded-xl border bg-background p-2.5 shadow-sm">
            {(attachments.length > 0 || mentions.length > 0) && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {mentions.map((doc) => (
                  <span key={doc.id} className="flex items-center gap-1.5 rounded-md border bg-muted/60 px-2 py-1 text-[11px]">
                    <FileText className="size-3 shrink-0" />
                    <span className="max-w-[12rem] truncate">{doc.title}</span>
                    <button
                      type="button"
                      onClick={() => setMentions((current) => current.filter((d) => d.id !== doc.id))}
                      aria-label={`Remove ${doc.title}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                {attachments.map((file, index) => (
                  <span
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-1.5 rounded-md border bg-muted/60 px-2 py-1 text-[11px]"
                  >
                    <Paperclip className="size-3 shrink-0" />
                    <span className="max-w-[12rem] truncate font-mono">{file.name}</span>
                    <span className="text-muted-foreground">{fileSize(file.sizeKb)}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((current) => current.filter((_, at) => at !== index))}
                      aria-label={`Remove ${file.name}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <label className="sr-only" htmlFor="requirements-chat-input">
              Ask about requirements, questions or drafts
            </label>
            <textarea
              id="requirements-chat-input"
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Write a message…"
              disabled={pending}
              className="w-full resize-none bg-transparent px-1 pt-0.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            <div className="mt-1.5 flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/gif,image/webp,text/*,.md,.csv,.tsv,.json,.log,.xml,.html,.yaml,.yml"
                className="hidden"
                onChange={(event) => void addFiles(event)}
                aria-hidden
                tabIndex={-1}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={pending || attachments.length >= MAX_ATTACHMENTS}
                title="Attach images or text files"
                aria-label="Attach files"
                className={iconButton}
              >
                <Plus className="size-4" />
              </button>
              <ChatMenu
                settings={settings}
                onSettingsChange={changeSettings}
                onAttach={() => fileInputRef.current?.click()}
                attachDisabled={pending || attachments.length >= MAX_ATTACHMENTS}
                docs={docs.filter((doc) => !mentions.some((m) => m.id === doc.id))}
                onMention={(doc) => {
                  setMentions((current) => [...current, doc].slice(0, 3));
                  textareaRef.current?.focus();
                }}
                onClear={newChat}
                clearDisabled={pending || turns.length === 0}
                rewindTargets={pending ? [] : rewindTargets}
                onRewind={rewindTo}
                usage={usage}
                connected={connected}
                onSubscription={() => onConnect(refreshConnection)}
              />
              <div className="ml-auto">
                {pending ? (
                  <button
                    type="button"
                    onClick={stop}
                    title="Stop the reply"
                    aria-label="Stop the reply"
                    className="rounded-md bg-foreground p-1 text-background"
                  >
                    <CircleStop className="size-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => send()}
                    disabled={!input.trim() && attachments.length === 0}
                    aria-label="Send"
                    className="rounded-md bg-foreground p-1 text-background disabled:opacity-30"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
