"use client";

import { cn } from "@/lib/utils";

/**
 * The module's existing sub-modules as chips under the field — one click
 * fills it in. Drawn by the app rather than a <datalist>, whose native popup
 * some browsers place badly inside a dialog.
 */
export function SubModuleSuggestions({
  names,
  value,
  onPick,
}: {
  names: string[];
  value: string;
  onPick: (name: string) => void;
}) {
  if (names.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Existing:</span>
      {names.map((name) => (
        <button
          key={name}
          type="button"
          onClick={() => onPick(name)}
          className={cn(
            "rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-muted",
            name === value.trim() && "border-primary bg-primary/10 text-primary",
          )}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
