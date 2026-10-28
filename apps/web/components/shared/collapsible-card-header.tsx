"use client";

import type { ReactNode } from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";

import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A card header that opens and closes its card: the title row is the
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
      {/* The title row is the toggle; the description stays outside it, so
          it can hold links of its own. */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="-m-1 flex w-full items-center gap-2 rounded-md p-1 text-left hover:bg-muted/40"
      >
        <CardTitle className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-base">{title}</CardTitle>
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {description && (
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">{description}</CardDescription>
      )}
    </CardHeader>
  );
}
