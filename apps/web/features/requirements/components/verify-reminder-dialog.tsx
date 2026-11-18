"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/utils/api-client";
import { formatRelative } from "@/utils/format";
import type { MentionablePerson } from "@/utils/mentions";
import { useMentions } from "@/features/comments/components/mentions";

type LastReminder = { by: string; at: string } | null;

/**
 * "Remind the PO": the requirements QA picked that are still unverified, or
 * every one waiting when none are picked, with an optional word. It lands in
 * the PO's bell and the team's Telegram chat; one an hour per project.
 */
export function VerifyReminderButton({
  projectId,
  selectedUnverified,
  totalUnverified,
  people = [],
}: {
  projectId: string;
  /** Picked in the list and not verified yet. */
  selectedUnverified: string[];
  totalUnverified: number;
  /** Who "@" offers; each one mentioned is reminded too. */
  people?: MentionablePerson[];
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [last, setLast] = useState<LastReminder>(null);
  const noteBox = useRef<HTMLTextAreaElement>(null);
  const mentions = useMentions({ people, value: note, onChange: setNote, textareaRef: noteBox });
  const picked = selectedUnverified.length > 0;
  const count = picked ? selectedUnverified.length : totalUnverified;

  useEffect(() => {
    if (!open) return;
    api
      .get<LastReminder>(`/api/projects/${projectId}/requirements/remind`)
      .then(setLast)
      .catch(() => setLast(null));
  }, [open, projectId]);

  // Sent within the hour: the server refuses another, so say so up front.
  const recent = last && Date.now() - new Date(last.at).getTime() < 60 * 60 * 1000;

  async function send() {
    setSending(true);
    try {
      const result = await api.post<{ waiting: number; to: string[] }>(
        `/api/projects/${projectId}/requirements/remind`,
        { requirementIds: picked ? selectedUnverified : undefined, note: note.trim() || undefined },
      );
      toast.success(`Reminded ${result.to.join(", ")}`, {
        description: `${result.waiting} requirement${result.waiting === 1 ? "" : "s"} to verify — in their notifications and on Telegram.`,
      });
      setOpen(false);
      setNote("");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={totalUnverified === 0}
        title={totalUnverified === 0 ? "Every requirement is verified" : "Ask the PO to verify the requirements still waiting"}
        onClick={() => setOpen(true)}
      >
        <BellRing className="mr-2 size-4" />
        Remind the PO
        {picked && ` (${selectedUnverified.length})`}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Remind the PO to verify</DialogTitle>
            <DialogDescription>
              {picked
                ? `The ${count} selected requirement${count === 1 ? "" : "s"} not verified yet.`
                : count === 1
                  ? "The one requirement not verified yet."
                  : `All ${count} requirements not verified yet.`}{" "}
              The PO gets it in their notifications, opening the list of what is waiting, and the team&apos;s
              Telegram chat gets it too.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="reminder-note">Message (optional)</Label>
            <div className="relative">
              <Textarea
                ref={noteBox}
                id="reminder-note"
                rows={3}
                maxLength={500}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  mentions.track(event.target);
                }}
                onClick={(event) => mentions.track(event.currentTarget)}
                onKeyUp={mentions.onKeyUp}
                onKeyDown={(event) => void mentions.onKeyDown(event)}
                onBlur={mentions.close}
                placeholder="e.g. We start drafting test cases for FR-14 on Monday. Type @ to mention someone."
              />
              {mentions.menu}
            </div>
            <p className="text-xs text-muted-foreground">Anyone you @mention is reminded too.</p>
          </div>

          {last && (
            <p className={recent ? "text-sm text-status-blocked" : "text-xs text-muted-foreground"}>
              Last reminded by {last.by} {formatRelative(last.at)}
              {recent && " — one reminder an hour; try again later."}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={sending || Boolean(recent)}>
              {sending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <BellRing className="mr-2 size-4" />}
              Send reminder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
