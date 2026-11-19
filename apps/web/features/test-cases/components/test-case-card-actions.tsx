"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  setScriptCardShown,
  useScriptCardShown,
} from "@/features/automation/script-card-visibility";

/**
 * The Test case card's own action: for a case not automated yet,
 * Automation, which adds the card to write its script.
 */
export function TestCaseCardActions({ showAutomation }: { showAutomation: boolean }) {
  const automationShown = useScriptCardShown();

  // Adds the Automation card to write a first script; the card's own Remove
  // takes it away again, and this comes back.
  if (!showAutomation || automationShown) return null;

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        setScriptCardShown(true);
        // Let it render, then bring it into view.
        requestAnimationFrame(() =>
          document.getElementById("automation")?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
      }}
    >
      <Plus className="mr-2 size-4" />
      Automation
    </Button>
  );
}
