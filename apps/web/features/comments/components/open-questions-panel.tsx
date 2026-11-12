"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleHelp, Loader2, MessageCircleQuestion, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { OPEN_QUESTIONS_FOR_PO, OPEN_QUESTIONS_FOR_QA } from "@/components/shared/open-questions";
import { api, errorMessage } from "@/utils/api-client";

/**
 * A case's open questions, at the top of its discussion — where they are
 * asked and answered. QA and the PO edit them here; they are kept on the
 * requirements the case verifies (or on the case, when it verifies none).
 */
export function OpenQuestionsPanel({
  testCaseId,
  text,
  note,
  canEdit,
  forPo,
  onAsk,
}: {
  testCaseId: string;
  text: string | null;
  /** Where they are kept. */
  note: string | null;
  /** QA and admins. */
  canEdit: boolean;
  /** The reader is the PO, whom the questions are for. */
  forPo: boolean;
  /** Start a comment asking them: QA, who asks. */
  onAsk?: (questions: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/test-cases/${testCaseId}/open-questions`, { openQuestions: draft });
      setEditing(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function startEditing() {
    setDraft(text ?? "");
    setEditing(true);
  }

  if (!text && !editing) {
    return canEdit ? (
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={startEditing}
      >
        <Plus className="size-3.5" aria-hidden />
        Add an open question for the PO
      </button>
    ) : null;
  }

  return (
    <section
      id="open-questions"
      className="scroll-mt-20 rounded-md border border-status-blocked/30 bg-status-blocked/5 px-3 py-2 text-sm"
    >
      <div className="flex min-h-7 items-center gap-1">
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-status-blocked">
          <CircleHelp className="size-3.5" aria-hidden />
          {forPo ? OPEN_QUESTIONS_FOR_PO : OPEN_QUESTIONS_FOR_QA}
        </h3>
        {canEdit && !editing && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Edit the open questions"
            title="Edit"
            onClick={startEditing}
          >
            <Pencil className="size-3.5" />
          </Button>
        )}
      </div>

      {editing ? (
        <div className="mt-1.5 space-y-2">
          <Textarea
            rows={4}
            autoFocus
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="- What exactly should the error message say?"
            aria-label="Open questions"
            className="bg-background"
          />
          <p className="text-xs text-muted-foreground">
            One per line. Remove a question once the PO has settled it.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 whitespace-pre-wrap">{text}</p>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            {note && <p className="text-xs text-muted-foreground">{note}</p>}
            {onAsk && text && (
              <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => onAsk(text)}>
                <MessageCircleQuestion className="mr-1.5 size-3.5" />
                Ask the PO
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
