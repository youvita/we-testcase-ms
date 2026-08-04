"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { ExecutionWithDetails } from "@/types";

/** Where the Record result card scrolls into view from a history click. */
export const EXECUTION_PANEL_ANCHOR = "execution-panel";

type ExecutionEditorValue = {
  /** Whether the Record result / Edit result card is expanded. */
  open: boolean;
  /** The entry being edited, or null when recording a new result. */
  editing: ExecutionWithDetails | null;
  startRecording: () => void;
  startEditing: (execution: ExecutionWithDetails) => void;
  close: () => void;
};

const ExecutionEditorContext = createContext<ExecutionEditorValue | null>(null);

/**
 * Owns the Record result card's open/editing state.
 *
 * It lives here rather than inside the card because three separate places drive
 * it: the card's own collapsed button, an entry clicked in the execution history
 * (a different grid column), and the sticky header that follows you down a long
 * test case.
 */
export function ExecutionEditorProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExecutionWithDetails | null>(null);

  const scrollToPanel = useCallback(() => {
    // On a narrow screen the panel sits below the history, so without this a
    // click from elsewhere on the page would appear to do nothing.
    document
      .getElementById(EXECUTION_PANEL_ANCHOR)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const startRecording = useCallback(() => {
    setEditing(null);
    setOpen(true);
    scrollToPanel();
  }, [scrollToPanel]);

  const startEditing = useCallback(
    (execution: ExecutionWithDetails) => {
      setEditing(execution);
      setOpen(true);
      scrollToPanel();
    },
    [scrollToPanel],
  );

  const close = useCallback(() => {
    setEditing(null);
    setOpen(false);
  }, []);

  const value = useMemo(
    () => ({ open, editing, startRecording, startEditing, close }),
    [open, editing, startRecording, startEditing, close],
  );

  return (
    <ExecutionEditorContext.Provider value={value}>
      {children}
    </ExecutionEditorContext.Provider>
  );
}

/**
 * Null outside a provider, so the history still renders (read-only) on pages
 * that do not show the Record result card.
 */
export function useExecutionEditor() {
  return useContext(ExecutionEditorContext);
}
