"use client";

import { Fragment, type ReactNode } from "react";

/**
 * A light reading of a reply: "- " / "1. " lists, "#" headings, **bold**,
 * *italic*, `code`, and [CODE] links to requirements that exist. Nothing is rendered
 * as HTML, so a reply cannot inject markup.
 */
export function ChatMarkdown({
  text,
  idByCode,
  onCode,
}: {
  text: string;
  idByCode: Map<string, string>;
  onCode: (id: string) => void;
}) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {lines.map((line, index) => {
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading) {
          return (
            <p key={index} className="pt-1 font-semibold">
              {inline(heading[1]!, idByCode, onCode)}
            </p>
          );
        }
        const bullet = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line);
        if (bullet) {
          const depth = Math.min(Math.floor(bullet[1]!.length / 2), 3);
          const marker = /\d/.test(bullet[2]!) ? bullet[2] : "•";
          return (
            <div key={index} className="flex gap-2" style={{ paddingLeft: depth * 16 }}>
              <span className="shrink-0 text-muted-foreground">{marker}</span>
              <span className="min-w-0">{inline(bullet[3]!, idByCode, onCode)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={index} className="h-2" />;
        return <p key={index}>{inline(line, idByCode, onCode)}</p>;
      })}
    </div>
  );
}

function inline(text: string, idByCode: Map<string, string>, onCode: (id: string) => void): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]\n]{1,60}\])/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{inline(part.slice(2, -2), idByCode, onCode)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={index}>{inline(part.slice(1, -1), idByCode, onCode)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={index} className="rounded bg-muted px-1 text-xs">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("[") && part.endsWith("]")) {
      const code = part.slice(1, -1).trim();
      const id = idByCode.get(code);
      if (id) {
        return (
          <button
            key={index}
            type="button"
            onClick={() => onCode(id)}
            className="rounded bg-primary/10 px-1 font-medium text-primary hover:underline"
            title="Show this requirement"
          >
            {code}
          </button>
        );
      }
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}
