"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Read-only code with line numbers, the failing line marked and scrolled
 * into view, and the error's headline under it.
 */
export function CodeView({
  code,
  errorLine,
  errorText,
  className,
}: {
  code: string;
  /** 1-based line to mark as where it failed. */
  errorLine?: number | null;
  /** Shown under the failing line. */
  errorText?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const lines = code.split("\n");
  const width = String(lines.length).length;

  // Bring the failing line into view inside the box, not the whole page.
  useEffect(() => {
    const container = containerRef.current;
    const mark = markRef.current;
    if (!container || !mark) return;
    container.scrollTop = Math.max(0, mark.offsetTop - container.clientHeight / 3);
  }, [errorLine, code]);

  return (
    <div
      ref={containerRef}
      className={cn("relative max-h-80 overflow-auto rounded-md border bg-background py-2 font-mono text-xs", className)}
    >
      {lines.map((line, index) => {
        const number = index + 1;
        const failing = number === errorLine;
        return (
          <div key={index} ref={failing ? markRef : undefined}>
            <div
              className={cn(
                "flex whitespace-pre-wrap pr-3",
                failing && "bg-status-failed/15",
              )}
            >
              <span
                className={cn(
                  "sticky left-0 shrink-0 select-none border-r pr-2 text-right text-muted-foreground",
                  failing ? "border-status-failed bg-status-failed/15 font-semibold text-status-failed" : "bg-background",
                )}
                style={{ width: `${width + 2.5}ch` }}
              >
                {failing ? "▶" : ""}
                {number}
              </span>
              <span className="pl-3">{line || " "}</span>
            </div>
            {failing && errorText && (
              <div className="ml-[3ch] border-l-2 border-status-failed bg-status-failed/5 px-3 py-1 font-sans text-xs text-status-failed">
                {errorText}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
