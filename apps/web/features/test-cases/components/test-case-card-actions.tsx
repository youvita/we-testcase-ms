"use client";

import { Bot, FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  setScriptCardShown,
  useScriptCardShown,
} from "@/features/automation/script-card-visibility";
import { downloadFile, errorMessage } from "@/utils/api-client";

/**
 * The Test case card's own actions: the FRD it comes from, and the
 * Automation card (script, runs and AI), shown on demand.
 */
export function TestCaseCardActions({
  testCaseId,
  hasFrd,
  showAutomation,
}: {
  testCaseId: string;
  /** Linked to a requirement, so there is a document to download. */
  hasFrd: boolean;
  showAutomation: boolean;
}) {
  const automationShown = useScriptCardShown();

  async function downloadFrd() {
    try {
      await downloadFile(`/api/test-cases/${testCaseId}/frd`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={!hasFrd}
        title={
          hasFrd
            ? "Download the FRD this case comes from (.md)"
            : "This case is not linked to a requirement document"
        }
        onClick={() => void downloadFrd()}
      >
        <FileText className="mr-2 size-4" />
        FRD
      </Button>
      {showAutomation && (
        <Button
          size="sm"
          variant={automationShown ? "secondary" : "outline"}
          aria-pressed={automationShown}
          onClick={() => {
            setScriptCardShown(!automationShown);
            if (!automationShown) {
              // Let it render, then bring it into view.
              requestAnimationFrame(() =>
                document
                  .getElementById("automation")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" }),
              );
            }
          }}
        >
          <Bot className="mr-2 size-4" />
          Automation
        </Button>
      )}
    </div>
  );
}
