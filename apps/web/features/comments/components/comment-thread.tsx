"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownRight, Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { ROLE_LABELS, toRole } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "@/utils/api-client";
import { formatDateTime, initials } from "@/utils/format";
import type { CommentWithAuthor } from "@/types";

/**
 * QA ↔ developer discussion on a test case.
 *
 * Separate from the execution history above it: that log is immutable and only
 * QA writes to it, whereas this is a conversation anyone signed in may join.
 * Keeping them visually distinct is what stops a developer's "fixed in 1.4.3"
 * from reading like a test result.
 */
export function CommentThread({
  testCaseId,
  comments,
  currentUserId,
  canComment,
  canModerate,
  canAnswer = false,
}: {
  testCaseId: string;
  comments: CommentWithAuthor[];
  currentUserId: string;
  canComment: boolean;
  canModerate: boolean;
  /** An admin — a PO — who can answer questions. */
  canAnswer?: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [sendingAnswer, setSendingAnswer] = useState(false);
  const byId = new Map(comments.map((comment) => [comment.id, comment]));

  async function handleAnswer(questionId: string) {
    const trimmed = answer.trim();
    if (!trimmed) return;
    setSendingAnswer(true);
    try {
      await api.post(`/api/comments/${questionId}/answer`, { body: trimmed });
      setAnswer("");
      setAnswering(null);
      toast.success("Answered — the person who asked is notified");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSendingAnswer(false);
    }
  }

  async function handlePost() {
    const trimmed = body.trim();
    if (!trimmed) return;

    setPosting(true);
    try {
      await api.post(`/api/test-cases/${testCaseId}/comments`, {
        body: trimmed,
      });
      setBody("");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(commentId: string) {
    setDeletingId(commentId);
    try {
      await api.delete(`/api/comments/${commentId}`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card id="discussion" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="text-base">Discussion</CardTitle>
        <CardDescription>
          {comments.length === 0
            ? "Ask a question or report a fix — QA and developers both post here."
            : `${comments.length} comment${comments.length === 1 ? "" : "s"}`}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {comments.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No comments yet"
            description="Use this to hand a failure back and forth without editing the test result."
          />
        ) : (
          <ol className="space-y-3">
            {comments.map((comment) => {
              const withdrawn = Boolean(comment.deletedAt);
              const question = comment.kind === "QUESTION";
              const answerTo = comment.answerToId ? byId.get(comment.answerToId) : undefined;
              return (
                <li
                  key={comment.id}
                  className={cn(
                    "flex items-start gap-3",
                    question && "rounded-md border-l-2 border-status-blocked bg-status-blocked/5 py-2 pl-2 pr-1",
                    comment.answerToId && "ml-6",
                  )}
                >
                  <Avatar className="size-7 shrink-0">
                    {comment.author.image && (
                      <AvatarImage src={comment.author.image} alt="" />
                    )}
                    <AvatarFallback className="text-xs">
                      {initials(comment.author.name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium">
                        {comment.author.name}
                      </span>
                      {/* The role is what tells QA whether a reply is coming from
                        engineering, so it is worth the space. */}
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {ROLE_LABELS[toRole(comment.author.role)]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(comment.createdAt)}
                      </span>
                      {question && (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="font-medium text-status-blocked">
                            Question for {comment.questionTo?.name ?? "the PO"}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                              comment.answeredAt
                                ? "bg-status-passed/10 text-status-passed"
                                : "bg-status-blocked/10 text-status-blocked",
                            )}
                          >
                            {comment.answeredAt ? "Answered" : "Waiting for an answer"}
                          </span>
                        </span>
                      )}
                      {comment.kind === "ANSWER" && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-status-passed">
                          <CornerDownRight className="size-3" aria-hidden />
                          Answer{answerTo ? ` to ${answerTo.author.name}` : ""}
                        </span>
                      )}
                      {comment.kind === "COMMENT" && comment.answerToId && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <CornerDownRight className="size-3" aria-hidden />
                          Follow-up
                        </span>
                      )}
                    </div>
                    {withdrawn ? (
                      // A tombstone, not a gap: replies below this one still need
                      // something to point at.
                      <p className="text-sm italic text-muted-foreground">
                        This comment was deleted
                        {comment.deletedAt
                          ? ` · ${formatDateTime(comment.deletedAt)}`
                          : ""}
                      </p>
                    ) : (
                      <p className="preserve-lines text-sm">{comment.body}</p>
                    )}
                    {question && !withdrawn && canAnswer && answering !== comment.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1 h-7"
                        onClick={() => {
                          setAnswering(comment.id);
                          setAnswer("");
                        }}
                      >
                        <CornerDownRight className="mr-1.5 size-3.5" />
                        Answer
                      </Button>
                    )}
                    {answering === comment.id && (
                      <div className="mt-2 space-y-2">
                        <Textarea
                          rows={3}
                          autoFocus
                          value={answer}
                          onChange={(event) => setAnswer(event.target.value)}
                          placeholder="The answer QA can test against — the message, the limit, the rule…"
                          aria-label="Write the answer"
                        />
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" disabled={sendingAnswer} onClick={() => setAnswering(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            disabled={sendingAnswer || !answer.trim()}
                            onClick={() => void handleAnswer(comment.id)}
                          >
                            {sendingAnswer ? (
                              <Loader2 className="mr-2 size-4 animate-spin" />
                            ) : (
                              <Send className="mr-2 size-4" />
                            )}
                            Send answer
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {!withdrawn &&
                    (canModerate || comment.author.id === currentUserId) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={deletingId === comment.id}
                        onClick={() => handleDelete(comment.id)}
                        aria-label={`Delete comment by ${comment.author.name}`}
                      >
                        {deletingId === comment.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    )}
                </li>
              );
            })}
          </ol>
        )}

        {canComment && (
          <div className="space-y-2 border-t pt-4">
            <Textarea
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Build number, root cause, what you changed, what QA should check…"
              aria-label="Write a comment"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handlePost}
                disabled={posting || !body.trim()}
              >
                {posting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Send className="mr-2 size-4" />
                )}
                Post comment
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
