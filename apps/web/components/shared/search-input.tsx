"use client";

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";

/**
 * Debounced search box that reports upward only after typing settles.
 *
 * `value` is treated as the external source of truth (the URL), so navigating
 * back or clearing filters elsewhere keeps the field in sync.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  tooltip,
  className,
  delay = 350,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Hover/focus hint spelling out what the box searches. */
  tooltip?: string;
  className?: string;
  delay?: number;
}) {
  const [draft, setDraft] = useState(value);
  const debounced = useDebounce(draft, delay);

  // Push the settled value up, but never re-emit the value we were just given.
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // `onChange` is intentionally omitted: callers commonly pass an inline
    // closure, and including it would fire on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // Adopt external changes (URL reset, "clear filters").
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const field = (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-9 pr-8"
      />
      {draft && (
        <button
          type="button"
          onClick={() => setDraft("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );

  if (!tooltip) return field;

  return (
    <Tooltip>
      {/* The wrapper is the trigger, not the input: Radix closes on pointer
          down, so clicking in to type dismisses the hint instead of leaving it
          hanging over the field. */}
      <TooltipTrigger asChild>{field}</TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
