"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CornerDownRight, MessageCircleQuestion } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ReplyBox } from "@/features/comments/components/reply-box";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/utils/api-client";
import { formatRelative, initials } from "@/utils/format";
import type { PoQuestionDto } from "@wetestcase/dto";

import { ResolveQuestionButton } from "./resolve-question-button";

/** What the Requirements page needs to ask and answer questions. */
export type PoContext = {
  /** Every active admin — the people who can answer. */
  admins: { id: string; name: string }[];
  currentUserId: string;
  canAsk: boolean;
  canAnswer: boolean;
};

/** A requirement or draft to open, from a notification's link. */
export type Focus = { tab: "requirements" | "drafts"; id: string };

const STATUS = {
  waiting: { label: "Waiting for PO", className: "text-status-blocked" },
  answered: { label: "Answered", className: "text-status-passed" },
  resolved: { label: "Resolved", className: "text-muted-foreground" },
} as const;

/**
 * The questions asked about one requirement or draft, each a conversation:
 * the PO answers under it, QA follows up under it, and either settles it.
 * Plain like a chat — no boxes; the reply field opens from "Reply".
 */
export function PoQuestions({
  questions,
  po,
  openQuestions = null,
  className,
}: {
  questions: PoQuestionDto[];
  po: PoContext;
  /** The open questions of what they were asked about: resolving can take those settled off. */
  openQuestions?: string | null;
  className?: string;
}) {
  if (!questions.length) return null;
  return (
    <ul className={cn("divide-y", className)}>
      {questions.map((question) => (
        <PoQuestionThread key={question.id} question={question} po={po} openQuestions={openQuestions} />
      ))}
    </ul>
  );
}

function PoQuestionThread({
  question,
  po,
  openQuestions,
}: {
  question: PoQuestionDto;
  po: PoContext;
  openQuestions: string | null;
}) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"reply" | "resolve" | null>(null);
  const resolved = question.status === "resolved";
  const [showResolved, setShowResolved] = useState(false);
  const collapsed = resolved && !showResolved;
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

  return (
    <li className="py-3 text-sm first:pt-0 last:pb-0">
      <Message
        person={question.asker}
        at={question.createdAt}
        meta={
          <>
            <span className="text-muted-foreground">→ {question.questionTo?.name ?? "the PO"}</span>
            <span className={cn("font-medium", STATUS[question.status].className)}>
              · {STATUS[question.status].label}
            </span>
          </>
        }
        action={
          canSettle && (
            <ResolveQuestionButton
              question={question}
              openQuestions={openQuestions}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            />
          )
        }
        body={question.body}
        clamp={collapsed}
      />

      {collapsed ? (
        <button
          type="button"
          className="ml-9 mt-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowResolved(true)}
        >
          Show conversation
          {question.replies.length
            ? ` (${question.replies.length} repl${question.replies.length === 1 ? "y" : "ies"})`
            : ""}
          {question.resolvedBy ? ` · resolved by ${question.resolvedBy.name}` : ""}
        </button>
      ) : (
        <div className="ml-9">
          {question.replies.length > 0 && (
            <ol className="mt-3 space-y-3">
              {question.replies.map((message) => (
                <li key={message.id}>
                  <Message
                    person={message.author}
                    at={message.createdAt}
                    meta={
                      message.author.isPo && (
                        <span className="rounded bg-status-passed/10 px-1 text-[10px] font-semibold text-status-passed">
                          PO
                        </span>
                      )
                    }
                    body={message.body}
                  />
                </li>
              ))}
            </ol>
          )}

          {canReply && !replying && (
            <button
              type="button"
              className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setReplying(true)}
            >
              <CornerDownRight className="size-3.5" aria-hidden />
              Reply
            </button>
          )}
          {canReply && replying && (
            <div className="mt-2">
              <ReplyBox
                value={draft}
                onChange={setDraft}
                onSend={() => void reply()}
                onCancel={() => setReplying(false)}
                sending={busy === "reply"}
                replyTo={(question.replies.at(-1)?.author ?? question.asker).name}
                ariaLabel={po.canAnswer ? "Answer the question" : "Follow up on the question"}
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** One message: avatar, name, when, then the text. */
function Message({
  person,
  at,
  meta,
  action,
  body,
  clamp = false,
}: {
  person: { name: string; image: string | null };
  at: string;
  meta?: ReactNode;
  action?: ReactNode;
  body: string;
  clamp?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Avatar className="size-7 shrink-0">
        {person.image && <AvatarImage src={person.image} alt="" />}
        <AvatarFallback className="text-[10px]">{initials(person.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
            <span className="font-semibold text-foreground">{person.name}</span>
            <span className="text-muted-foreground">{formatRelative(at)}</span>
            {meta}
          </p>
          {action}
        </div>
        <p className={cn("mt-0.5 whitespace-pre-wrap", clamp && "line-clamp-1 text-muted-foreground")}>{body}</p>
      </div>
    </div>
  );
}

/** A row's question state at a glance: waiting beats answered beats resolved. */
export function PoQuestionBadge({ questions }: { questions: PoQuestionDto[] }) {
  if (!questions.length) return null;
  const waiting = questions.filter((question) => question.status === "waiting").length;
  const answered = questions.some((question) => question.status === "answered");
  const [label, className] = waiting
    ? [`Waiting for PO${waiting > 1 ? ` (${waiting})` : ""}`, "text-status-blocked"]
    : answered
      ? ["PO answered", "text-status-passed"]
      : ["Questions resolved", "text-muted-foreground"];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", className)}>
      <MessageCircleQuestion className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}
