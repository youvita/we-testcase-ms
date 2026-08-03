"use client";

import { ClipboardCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useExecutionEditor } from "./execution-editor-context";

/**
 * Opens the Record result card from the page header.
 *
 * It lives up here rather than in the right-hand column so it stays reachable
 * while the header is stuck to the top of a long test case. Hidden while the
 * card is already open — the form has its own Save and Cancel by then.
 */
export function RecordResultButton() {
  const editor = useExecutionEditor();
  if (!editor || editor.open) return null;

  return (
    <Button onClick={editor.startRecording}>
      <ClipboardCheck className="mr-2 size-4" />
      Record result
    </Button>
  );
}
