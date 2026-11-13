"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One stop on a guided tour. `target` names a `data-tour` attribute on the
 * page; with several, the first one showing is used (the sidebar on a desktop,
 * the menu button on a phone). Without a target — or none of them showing —
 * the card sits in the middle of the screen.
 */
export type CoachStep = {
  target?: string | string[];
  title: string;
  body: ReactNode;
  /** Icon or picture over a centred card (welcome, finish). */
  art?: ReactNode;
};

const CARD_WIDTH = 340;
const GAP = 14;
const EDGE = 12;
const PAD = 6;

/** Fired by "Show the guide" in the account menu. */
export const REPLAY_EVENT = "wtc:tour:replay";
/** Fired when a tour closes, so the next one can take its turn. */
const DONE_EVENT = "wtc:tour:done";

function storageKey(tourId: string, userId: string) {
  return `wtc:tour:${tourId}:${userId}`;
}

/** Whether this person has finished or skipped the tour on this browser. */
export function tourSeen(tourId: string, userId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(tourId, userId)) !== null;
  } catch {
    // Storage blocked: never nag on every page.
    return true;
  }
}

function markSeen(tourId: string, userId: string) {
  try {
    window.localStorage.setItem(storageKey(tourId, userId), new Date().toISOString());
  } catch {
    // Nothing to keep it in; the tour just shows again next time.
  }
}

function findTarget(target: CoachStep["target"]): HTMLElement | null {
  if (!target) return null;
  for (const name of Array.isArray(target) ? target : [target]) {
    for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden") return element;
    }
  }
  return null;
}

type Box = { top: number; left: number; width: number; height: number };

function sameBox(a: Box | null, b: Box | null) {
  return a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);
}

/** Beside a target at the screen's left edge (the sidebar), else under it, or over it when there is no room. */
function placeCard(box: Box, card: { width: number; height: number }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), vw - card.width - EDGE);
  const clampY = (y: number) => Math.min(Math.max(y, EDGE), vh - card.height - EDGE);

  if (box.left + box.width < vw * 0.3 && box.left + box.width + GAP + card.width < vw - EDGE) {
    return { left: box.left + box.width + PAD + GAP, top: clampY(box.top + box.height / 2 - card.height / 2) };
  }
  const left = clampX(box.left + box.width / 2 - card.width / 2);
  const below = box.top + box.height + PAD + GAP;
  if (below + card.height < vh - EDGE) return { left, top: below };
  return { left, top: clampY(box.top - PAD - GAP - card.height) };
}

/**
 * A first-time guide: dims the page, lights up one thing at a time and says
 * what it is for. It starts by itself until the person finishes or skips it
 * (remembered per person, on this browser), and "Show the guide" replays it.
 *
 * `after` holds it back until another tour is done, so two never start at
 * once. `priority` picks which tour a replay starts when two are on a page —
 * the one about the page itself.
 */
export function CoachMarks({
  tourId,
  userId,
  steps,
  after,
  priority = 0,
}: {
  tourId: string;
  userId: string;
  steps: CoachStep[];
  after?: string;
  priority?: number;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  // The steps for this visit: one whose target is not on the page (a button
  // this role does not get, an empty list) is left out, not shown floating.
  // Kept as positions in `steps`, not copies, so an open guide shows the
  // steps' current wording.
  const [picked, setPicked] = useState<number[]>([]);
  const [box, setBox] = useState<Box | null>(null);
  const [cardSize, setCardSize] = useState({ width: CARD_WIDTH, height: 200 });
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  // Read through a ref: callers build `steps` afresh on each render, and a
  // changing `start` would keep restarting the first-time timer.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const start = useCallback(() => {
    const present = stepsRef.current.flatMap((step, at) => (!step.target || findTarget(step.target) ? [at] : []));
    if (!present.length) return;
    setPicked(present);
    setIndex(0);
    setOpen(true);
  }, []);

  // First time: start once the page has settled, after any tour it waits for.
  useEffect(() => {
    if (tourSeen(tourId, userId)) return;
    let timer: number | undefined;
    const tryStart = () => {
      // Checked again each time: by now this tour may have been finished.
      if (tourSeen(tourId, userId)) return;
      if (after && !tourSeen(after, userId)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (tourSeen(tourId, userId)) return;
        start();
      }, 700);
    };
    tryStart();
    // Only the tour this one waits for: its own "done" must not restart it.
    const onDone = (event: Event) => {
      if (after && (event as CustomEvent<string>).detail === after) tryStart();
    };
    window.addEventListener(DONE_EVENT, onDone);
    return () => {
      window.removeEventListener(DONE_EVENT, onDone);
      window.clearTimeout(timer);
    };
  }, [tourId, userId, after, start]);

  // Replay: only the tour with the highest priority on the page answers.
  useEffect(() => {
    const onReplay = (event: Event) => {
      const claim = event as CustomEvent<{ priority: number; tourId: string | null }>;
      if (claim.detail.priority > priority) return;
      if (claim.detail.priority === priority && claim.detail.tourId !== tourId) return;
      start();
    };
    const onClaim = (event: Event) => {
      const claim = event as CustomEvent<{ priority: number; tourId: string | null }>;
      if (priority > claim.detail.priority) {
        claim.detail.priority = priority;
        claim.detail.tourId = tourId;
      }
    };
    window.addEventListener(`${REPLAY_EVENT}:claim`, onClaim);
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => {
      window.removeEventListener(`${REPLAY_EVENT}:claim`, onClaim);
      window.removeEventListener(REPLAY_EVENT, onReplay);
    };
  }, [tourId, priority, start]);

  const shown = picked.flatMap((at) => (steps[at] ? [steps[at]] : []));
  const step = shown[index];
  // What the follow effect depends on: the step's target, not the step object,
  // which callers may rebuild on every render.
  const targetKey = step ? [index, ...(Array.isArray(step.target) ? step.target : [step.target ?? ""])].join("|") : "";
  const last = index === shown.length - 1;

  const close = useCallback(() => {
    setOpen(false);
    markSeen(tourId, userId);
    window.dispatchEvent(new CustomEvent(DONE_EVENT, { detail: tourId }));
  }, [tourId, userId]);

  // Bring the target into view, then follow it while the step is showing
  // (scrolling, resizing, a layout that is still loading).
  useEffect(() => {
    if (!open || !step) return;
    const element = findTarget(step.target);
    if (element) {
      const rect = element.getBoundingClientRect();
      if (rect.top < 64 || rect.bottom > window.innerHeight - 24) {
        element.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
    let frame = 0;
    let previous: Box | null = null;
    const follow = () => {
      const current = findTarget(step.target);
      const rect = current?.getBoundingClientRect();
      const next = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null;
      if (!sameBox(previous, next)) {
        previous = next;
        setBox(next);
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on targetKey
  }, [open, targetKey]);

  // The page holds still while the guide is open. `overflow: hidden` stops
  // the wheel, touch and keys but still lets the guide scroll a target into
  // view; the scrollbar's width is kept as padding so nothing jumps sideways.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const scrollbar = window.innerWidth - root.clientWidth;
    const before = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
    root.style.overflow = "hidden";
    if (scrollbar > 0) {
      const current = parseFloat(getComputedStyle(root).paddingRight) || 0;
      root.style.paddingRight = `${current + scrollbar}px`;
    }
    return () => {
      root.style.overflow = before.overflow;
      root.style.paddingRight = before.paddingRight;
    };
  }, [open]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const { width, height } = card.getBoundingClientRect();
    if (width !== cardSize.width || height !== cardSize.height) setCardSize({ width, height });
  });

  useEffect(() => {
    if (open) nextRef.current?.focus();
  }, [open, index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (last) close();
        else setIndex((current) => current + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, last, close]);

  if (!mounted || !open || !step) return null;

  const centred = !box;
  const position = box ? placeCard(box, cardSize) : null;

  return createPortal(
    // Over everything, toasts included (sonner sits at 999999999).
    <div className="fixed inset-0" style={{ zIndex: 1_000_000_000 }} role="presentation">
      {/* Catches clicks: the page waits while the guide is open. */}
      <div className={cn("absolute inset-0", centred && "bg-slate-950/55 transition-colors")} />
      {box && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl transition-all duration-300 ease-out"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
            // A white edge, so it shows on the dark sidebar too, then the dimming.
            boxShadow: "0 0 0 2px rgb(255 255 255), 0 0 0 6px rgb(255 255 255 / 0.25), 0 0 0 9999px rgb(2 6 23 / 0.55)",
          }}
        />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coach-title"
        aria-describedby="coach-body"
        className={cn(
          "absolute rounded-xl border bg-popover p-4 text-popover-foreground shadow-2xl transition-[top,left] duration-300 ease-out",
          centred && "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center",
        )}
        style={{
          width: `min(${CARD_WIDTH}px, calc(100vw - ${EDGE * 2}px))`,
          ...(position ? { top: position.top, left: position.left } : {}),
        }}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close the guide"
          className="absolute right-2.5 top-2.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        {centred && step.art && <div className="mb-3 flex justify-center">{step.art}</div>}
        <h2 id="coach-title" className={cn("pr-6 text-base font-semibold", centred && "px-6")}>
          {step.title}
        </h2>
        <div id="coach-body" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {step.body}
        </div>

        <div className={cn("mt-4 flex items-center gap-2", centred ? "justify-center" : "justify-between")}>
          {shown.length > 1 && !centred && (
            <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {index + 1} of {shown.length}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {index === 0 ? (
              shown.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={close}>
                  Skip
                </Button>
              )
            ) : (
              <Button type="button" variant="ghost" size="sm" onClick={() => setIndex(index - 1)}>
                <ArrowLeft className="mr-1 size-3.5" /> Back
              </Button>
            )}
            <Button
              ref={nextRef}
              type="button"
              size="sm"
              onClick={() => (last ? close() : setIndex(index + 1))}
            >
              {last ? (
                <>
                  <Check className="mr-1 size-3.5" /> Got it
                </>
              ) : index === 0 && centred ? (
                <>
                  Show me around <ArrowRight className="ml-1 size-3.5" />
                </>
              ) : (
                <>
                  Next <ArrowRight className="ml-1 size-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Where you are in the tour, as dots. */}
        {shown.length > 1 && centred && (
          <div className="mt-3 flex justify-center gap-1" aria-hidden>
            {shown.map((_, dot) => (
              <span
                key={dot}
                className={cn("h-1.5 rounded-full transition-all", dot === index ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30")}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Start the guide for the page you are on (the account menu's "Show the
 * guide"): the tours mounted here bid, and the one about this page wins.
 */
export function replayGuide() {
  const claim = { priority: -1, tourId: null as string | null };
  window.dispatchEvent(new CustomEvent(`${REPLAY_EVENT}:claim`, { detail: claim }));
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: claim }));
}
