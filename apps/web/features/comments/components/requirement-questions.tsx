"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CornerDownRight, FileText, HelpCircle, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PoContext } from "@/features/requirements/components/po-questions";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/utils/api-client";
import { formatDateTime, initials } from "@/utils/format";
import type { PoQuestionDto } from "@wetestcase/dto";

export type RequirementQuestionGroup = {
  requirement: { id: string; code: string; title: string };
  questions: PoQuestionDto[];
};

const STATUS = {
  waiting: { label: "Waiting for PO", className: "font-medium text-status-blocked" },
  answered: { label: "Answered", className: "" },
  resolved: { label: "Resolved", className: "" },
} as const;

/**
 * A question asked on a requirement this case verifies, shown in the case's
 * discussion among its comments, in time order and in the same style. It is
 * the requirement's own thread: a reply here lands there, and every other
 * case verifying the requirement shows it too.
 */
export function RequirementQuestionItem({
  projectId,
  requirement,
  question,
  po,
}: {
  projectId: string;
  requirement: RequirementQuestionGroup["requirement"];
  question: PoQuestionDto;
  po: PoContext;
}) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"reply" | "resolve" | null>(null);
  const resolved = question.status === "resolved";
  const canReply = (po.canAsk || po.canAnswer) && !resolved;
  const canSettle = po.canAnswer || question.asker.id === po.currentUserId;

  async function reply() {
    if (!draft.trim() || busy) return;
    setBusy("reply");
    try {
      await api.post(`/api/po-questions/${question.id}/replies`, { body: draft.trim() });
      setDraft("");
      setReplying(false);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function settle(next: boolean) {
    setBusy("resolve");
    try {
      await api.post(`/api/po-questions/${question.id}/resolve`, { resolved: next });
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <li className="flex items-start gap-3">
        <Person person={question.asker} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              <span className="text-sm font-medium text-foreground">{question.asker.name}</span>
              {" · QA · "}
              {formatDateTime(question.createdAt)}
            </p>
            {canSettle && (
              <button
                type="button"
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => void settle(!resolved)}
              >
                {busy === "resolve" ? "…" : resolved ? "Reopen" : "Mark resolved"}
              </button>
            )}
          </div>
          <Link
            href={`/projects/${projectId}/requirements?tab=requirements&focus=${requirement.id}`}
            className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            title={`On requirement ${requirement.code} — open it on the Requirements page`}
          >
            <FileText className="size-3 shrink-0" aria-hidden />
            <span className="font-mono">{requirement.code}</span>
            <span className="truncate">{requirement.title}</span>
          </Link>
          <p className={cn("preserve-lines text-sm", resolved && "text-muted-foreground")}>{question.body}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <HelpCircle className="size-3.5" aria-hidden />
            Question for {question.questionTo?.name ?? "the PO"}
            {" · "}
            <span className={STATUS[question.status].className}>{STATUS[question.status].label}</span>
            {resolved && question.resolvedBy && ` by ${question.resolvedBy.name}`}
          </p>
          {canReply && !replying && question.replies.length === 0 && (
            <ReplyButton onClick={() => setReplying(true)} answer={po.canAnswer} />
          )}
        </div>
      </li>

      {question.replies.map((message, index) => (
        <li key={message.id} className="ml-9 flex items-start gap-3">
          <Person person={message.author} />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs text-muted-foreground">
              <span className="text-sm font-medium text-foreground">{message.author.name}</span>
              {message.author.isPo ? " · Admin · " : " · QA · "}
              {formatDateTime(message.createdAt)}
              {message.author.isPo ? " · Answer" : " · Follow-up"}
            </p>
            <p className="preserve-lines text-sm">{message.body}</p>
            {canReply && !replying && index === question.replies.length - 1 && (
              <ReplyButton onClick={() => setReplying(true)} />
            )}
          </div>
        </li>
      ))}

      {replying && (
        <li className="ml-9 space-y-2">
          <Textarea
            rows={3}
            autoFocus
            value={draft}
            disabled={busy === "reply"}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={po.canAnswer ? "Answer…" : "Follow up…"}
            aria-label={po.canAnswer ? "Answer the question" : "Follow up on the question"}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy === "reply"} onClick={() => setReplying(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy === "reply" || !draft.trim()} onClick={() => void reply()}>
              {busy === "reply" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
              {po.canAnswer ? "Send answer" : "Send reply"}
            </Button>
          </div>
        </li>
      )}
    </>
  );
}

function Person({ person }: { person: { name: string; image: string | null } }) {
  return (
    <Avatar className="size-7 shrink-0">
      {person.image && <AvatarImage src={person.image} alt="" />}
      <AvatarFallback className="text-xs">{initials(person.name)}</AvatarFallback>
    </Avatar>
  );
}

function ReplyButton({ onClick, answer = false }: { onClick: () => void; answer?: boolean }) {
  return (
    <Button
      variant={answer ? "outline" : "ghost"}
      size="sm"
      className={cn("mt-1 h-7", !answer && "-ml-2 px-2 text-muted-foreground")}
      onClick={onClick}
    >
      <CornerDownRight className="mr-1.5 size-3.5" />
      {answer ? "Answer" : "Reply"}
    </Button>
  );
}
