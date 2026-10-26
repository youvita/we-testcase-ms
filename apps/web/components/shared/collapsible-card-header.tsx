"use client";

import type { ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";

import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A card header that opens and closes its card: the whole header is the
 * button, with arrows on the right — apart to open, together to close.
 */
export function CollapsibleCardHeader({
  expanded,
  onToggle,
  title,
  description,
}: {
  expanded: boolean;
  onToggle: () => void;
  title: ReactNode;
  description?: ReactNode;
}) {
  const Icon = expanded ? ChevronsDownUp : ChevronsUpDown;
  return (
    <CardHeader className={cn("space-y-1", !expanded && "pb-6")}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="-m-1 flex w-full items-start gap-2 rounded-md p-1 text-left hover:bg-muted/40"
      >
        <span className="min-w-0 flex-1 space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">{title}</CardTitle>
          {description && (
            <CardDescription className="flex flex-wrap items-center gap-x-2">{description}</CardDescription>
          )}
        </span>
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </CardHeader>
  );
}
