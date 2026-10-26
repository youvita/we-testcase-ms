"use client";

import { FileText, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  setScriptCardShown,
  useScriptCardShown,
} from "@/features/automation/script-card-visibility";
import { downloadFile, errorMessage } from "@/utils/api-client";

/**
 * The Test case card's own actions: the FRD it comes from, and — for a
 * case not automated yet — Automation, which shows the card to write its
 * script. A case with a script has that card on the page already.
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
      {/* Adds the Automation card to write a first script; the card's own
          Remove takes it away again, and this comes back. */}
      {showAutomation && !automationShown && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setScriptCardShown(true);
            // Let it render, then bring it into view.
            requestAnimationFrame(() =>
              document
                .getElementById("automation")
                ?.scrollIntoView({ behavior: "smooth", block: "start" }),
            );
          }}
        >
          <Plus className="mr-2 size-4" />
          Automation
        </Button>
      )}
    </div>
  );
}
