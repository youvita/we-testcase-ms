"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the Script & AI card is showing on the test case page. Shared by
 * the card and the Automation button in the Test case card, which sit in
 * different parts of a server-rendered page.
 */
let shown = false;
const listeners = new Set<() => void>();

export function setScriptCardShown(next: boolean) {
  if (next === shown) return;
  shown = next;
  for (const listener of listeners) listener();
}

export function useScriptCardShown(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shown,
    () => false,
  );
}
