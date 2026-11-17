"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { ApiError, api, errorMessage } from "@/utils/api-client";

export type ScriptLines = { from: number; to: number } | null;

type Message = { role: "user" | "assistant"; text: string };

/** One click for what people most often want to know. */
const QUICK = [
  "What does this do, step by step?",
  "Why could this fail?",
  "What do I need to set up for it to run?",
];

/**
 * "Explain with AI": what the script — or the lines picked out — does, in
 * plain words, and follow-up questions on it. It reads the code as it is in
 * the editor, saved or not, and never changes it.
 *
 * Kept while the panel is open; a new pick of lines starts afresh.
 */
export function ScriptExplainPanel({
  testCaseId,
  code,
  lines,
  onClose,
  onNeedsConnection,
}: {
  testCaseId: string;
  code: string;
  lines: ScriptLines;
  onClose: () => void;
  /** No Claude connection yet: connect, then `retry`. */
  onNeedsConnection: (retry: () => void) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const scope = lines ? (lines.from === lines.to ? `line ${lines.from}` : `lines ${lines.from}–${lines.to}`) : "the whole script";

  async function ask(text: string, before: Message[] = messages) {
    const next = [...before, { role: "user" as const, text }];
    setMessages(next);
    setQuestion("");
    setAsking(true);
    try {
      const { answer } = await api.post<{ answer: string }>(`/api/test-cases/${testCaseId}/script/explain`, {
        code,
        lines,
        messages: next.slice(-20),
      });
      setMessages([...next, { role: "assistant", text: answer }]);
    } catch (error) {
      // Not sent: take the question back so it can be asked again.
      setMessages(before);
      setQuestion(text);
      if (error instanceof ApiError && error.status === 412) onNeedsConnection(() => void ask(text, before));
      else setMessages([...before, { role: "assistant", text: `⚠️ ${errorMessage(error)}` }]);
    } finally {
      setAsking(false);
    }
  }

  // Opening it, or picking other lines, explains them straight away.
  const scopeKey = lines ? `${lines.from}-${lines.to}` : "all";
  const explained = useRef<string | null>(null);
  useEffect(() => {
    // Once per pick, even when React runs effects twice in development.
    if (explained.current === scopeKey) return;
    explained.current = scopeKey;
    void ask(lines ? "Explain what these lines do." : "Explain what this script does.", []);
    // Only when what is being explained changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages, asking]);

  return (
    <div className="rounded-lg border bg-muted/30" data-tour="script-explain">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate">Explaining {scope}</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the explanation"
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="max-h-96 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        {messages.map((message, index) =>
          message.role === "user" ? (
            <p key={index} className="ml-auto w-fit max-w-[85%] rounded-lg bg-primary px-3 py-1.5 text-primary-foreground">
              {message.text}
            </p>
          ) : (
            <div key={index} className="preserve-lines max-w-[95%] leading-relaxed">
              <WithCode text={message.text} />
            </div>
          ),
        )}
        {asking && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> The AI is reading the script…
          </p>
        )}
        <div ref={bottom} />
      </div>

      <div className="space-y-2 border-t px-3 py-2.5">
        {!asking && messages.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((quick) => (
              <button
                key={quick}
                type="button"
                onClick={() => void ask(quick)}
                className="rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {quick}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1 rounded-md border border-input bg-background py-1 pl-3 pr-1 shadow-sm focus-within:ring-1 focus-within:ring-ring">
          <textarea
            rows={1}
            value={question}
            disabled={asking}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (question.trim() && !asking) void ask(question.trim());
              }
            }}
            placeholder={`Ask a follow-up about ${scope}…`}
            aria-label="Ask the AI about the script"
            className="max-h-32 min-w-0 flex-1 resize-none self-center bg-transparent py-1.5 text-base placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-50 md:text-sm"
          />
          <button
            type="button"
            disabled={asking || !question.trim()}
            onClick={() => void ask(question.trim())}
            aria-label="Ask"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-primary hover:bg-muted disabled:text-muted-foreground disabled:opacity-50"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** The answer's `code` and ```blocks``` in monospace, **bold** in bold; the rest as written. */
function WithCode({ text }: { text: string }) {
  return (
    <>
      {text.split(/(```[\s\S]*?```)/g).map((part, i) =>
        part.startsWith("```") ? (
          <pre key={i} className="my-1.5 overflow-x-auto rounded-md border bg-background p-2 font-mono text-xs">
            {part.replace(/^```[\w-]*\n?/, "").replace(/```$/, "").trimEnd()}
          </pre>
        ) : (
          <Fragment key={i}>
            {part.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((bit, j) =>
              bit.startsWith("`") && bit.endsWith("`") && bit.length > 2 ? (
                <code key={j} className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]")}>
                  {bit.slice(1, -1)}
                </code>
              ) : bit.startsWith("**") && bit.endsWith("**") && bit.length > 4 ? (
                <strong key={j} className="font-semibold">
                  {bit.slice(2, -2)}
                </strong>
              ) : (
                bit
              ),
            )}
          </Fragment>
        ),
      )}
    </>
  );
}
