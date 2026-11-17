"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ROLE_LABELS, toRole } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { initials } from "@/utils/format";
import { mentionAt, splitMentions, type MentionablePerson } from "@/utils/mentions";

export type { MentionablePerson };

/** At most this many people in the list at once; typing narrows it. */
const SHOWN = 6;

/** Keys the open list handles itself: typing them must not move the caret. */
const LIST_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]);

/**
 * "@" in a box opens a list of the people who can read the post; picking one
 * puts `@username` in the text, which is what notifies them.
 *
 * Wire the box with `track` (onChange, onClick, onKeyUp), `onKeyDown` first
 * in the box's own key handler — when it returns true the key was the list's
 * — and `close` on blur. Render `menu` in a `relative` wrapper round the box.
 */
export function useMentions({
  people,
  value,
  onChange,
  textareaRef,
}: {
  people: MentionablePerson[];
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [active, setActive] = useState<{ start: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);
  // Where the caret goes once the picked name is in the box: straight after
  // that render, before the next key lands.
  const caretAfter = useRef<number | null>(null);
  useLayoutEffect(() => {
    const box = textareaRef.current;
    if (caretAfter.current === null || !box) return;
    box.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  });

  const query = active?.query.toLowerCase() ?? "";
  const matches = active
    ? people
        .filter(
          (person) =>
            person.username.toLowerCase().startsWith(query) ||
            person.name.toLowerCase().split(/\s+/).some((word) => word.startsWith(query)),
        )
        .slice(0, SHOWN)
    : [];
  const open = matches.length > 0;

  function track(box: HTMLTextAreaElement) {
    const next = mentionAt(box.value, box.selectionStart);
    setActive(next);
    if (next?.query !== active?.query) setIndex(0);
  }

  function pick(person: MentionablePerson) {
    const box = textareaRef.current;
    if (!active || !box) return;
    const before = value.slice(0, active.start);
    const after = value.slice(box.selectionStart).replace(/^[a-zA-Z0-9_.]*/, "");
    const inserted = `@${person.username}${after.startsWith(" ") ? "" : " "}`;
    caretAfter.current = before.length + inserted.length;
    onChange(before + inserted + after);
    setActive(null);
    box.focus();
  }

  /** True when the key was for the list. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open || event.nativeEvent.isComposing) return false;
    if (event.key === "ArrowDown") setIndex((index + 1) % matches.length);
    else if (event.key === "ArrowUp") setIndex((index - 1 + matches.length) % matches.length);
    else if (event.key === "Enter" || event.key === "Tab") pick(matches[Math.min(index, matches.length - 1)]!);
    else if (event.key === "Escape") setActive(null);
    else return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  const menu = open ? (
    <ul
      role="listbox"
      aria-label="Mention someone"
      className="absolute left-0 top-full z-50 mt-1 w-72 max-w-full overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {matches.map((person, i) => (
        <li
          key={person.id}
          role="option"
          aria-selected={i === index}
          // Mouse down, not click: a click would blur the box and close the list first.
          onMouseDown={(event) => {
            event.preventDefault();
            pick(person);
          }}
          onMouseEnter={() => setIndex(i)}
          className={cn(
            "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
            i === index && "bg-accent text-accent-foreground",
          )}
        >
          <Avatar className="size-6 shrink-0">
            {person.image && <AvatarImage src={person.image} alt="" />}
            <AvatarFallback className="text-[10px]">{initials(person.name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{person.name}</span>{" "}
            <span className="text-muted-foreground">@{person.username}</span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{ROLE_LABELS[toRole(person.role)]}</span>
        </li>
      ))}
    </ul>
  ) : null;

  return {
    menu,
    onKeyDown,
    track,
    /** For onKeyUp: moving the caret may leave or enter a mention. */
    onKeyUp: (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!LIST_KEYS.has(event.key)) track(event.currentTarget);
    },
    close: () => setActive(null),
  };
}

/**
 * A post's text with each @mention of someone who can read it picked out, by
 * name. Anything else after an "@" stays as typed.
 */
export function MentionText({
  body,
  people,
  className,
}: {
  body: string;
  people: MentionablePerson[];
  className?: string;
}) {
  const byUsername = new Map(people.map((person) => [person.username.toLowerCase(), person]));
  return (
    <p className={className}>
      {splitMentions(body).map((part, i) => {
        const person = "mention" in part ? byUsername.get(part.mention) : undefined;
        return person ? (
          <span
            key={i}
            title={`@${person.username}`}
            className="whitespace-nowrap rounded bg-primary/10 px-0.5 font-medium text-primary"
          >
            @{person.name}
          </span>
        ) : (
          part.text
        );
      })}
    </p>
  );
}
