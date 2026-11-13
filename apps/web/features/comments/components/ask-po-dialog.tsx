"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircleQuestion, Send } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ImproveWritingButton } from "@/features/ai/components/improve-writing-button";
import { api, errorMessage } from "@/utils/api-client";

const EVERY_ADMIN = "__all";

/**
 * Ask the PO to clarify a test case, a requirement or a review draft. The
 * admins asked get a notification, and the asker another when it is answered.
 */
export function AskPoDialog({
  ask,
  where,
  admins,
  currentUserId,
  openQuestions,
  label = "Ask the PO",
  size = "sm",
}: {
  /** Where the question is posted, and anything the request needs besides it. */
  ask: { url: string; extra?: Record<string, unknown> };
  /** Where the question will show, for the dialog's description. */
  where: string;
  /** Every active admin — the people who can answer. */
  admins: { id: string; name: string }[];
  currentUserId: string;
  /** The case's open questions, to start the question from. */
  openQuestions: string | null;
  /** "New question" where questions have been asked already: replies go under those. */
  label?: string;
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const others = admins.filter((admin) => admin.id !== currentUserId);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(EVERY_ADMIN);
  const [body, setBody] = useState("");
  const [improving, setImproving] = useState(false);
  const [sending, setSending] = useState(false);

  function start() {
    setTo(EVERY_ADMIN);
    setBody(openQuestions ? `Could you clarify:\n${openQuestions}` : "");
    setOpen(true);
  }

  async function send() {
    setSending(true);
    try {
      await api.post(ask.url, {
        ...ask.extra,
        body: body.trim(),
        toUserId: to === EVERY_ADMIN ? undefined : to,
      });
      const name = others.find((admin) => admin.id === to)?.name;
      toast.success(name ? `Asked ${name}` : `Asked ${others.length === 1 ? others[0]!.name : "every admin"}`);
      setOpen(false);
      router.refresh();
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
        size={size}
        onClick={start}
        disabled={others.length === 0}
        title={others.length === 0 ? "There is no admin to ask. Add the PO as an admin user." : undefined}
      >
        <MessageCircleQuestion className="mr-2 size-4" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={(next) => !sending && setOpen(next)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ask the PO</DialogTitle>
            <DialogDescription>
              The question shows {where}, and the PO gets a notification. You are told when it is
              answered.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Ask</Label>
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EVERY_ADMIN}>Every admin ({others.length})</SelectItem>
                  {others.map((admin) => (
                    <SelectItem key={admin.id} value={admin.id}>
                      {admin.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ask-po-question">Question</Label>
              <Textarea
                id="ask-po-question"
                rows={6}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={improving}
                placeholder="What should the error message say when the amount is zero?"
              />
              <ImproveWritingButton text={body} onChange={setBody} disabled={sending} onBusyChange={setImproving} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={sending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={sending || improving || !body.trim()} onClick={() => void send()}>
              {sending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
              Send question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
