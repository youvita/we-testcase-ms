"use client";

import { Fragment, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownRight, HelpCircle, Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
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
import { answersToApply } from "@/utils/po-answers";
import type { CommentWithAuthor } from "@/types";

import type { PoContext } from "@/features/requirements/components/po-questions";

import type { CaseText } from "./apply-answer-dialog";
import { CaseUpdatePrompt } from "./case-update-prompt";
import { OpenQuestionsPanel } from "./open-questions-panel";
import { RequirementQuestionItem, type RequirementQuestionGroup } from "./requirement-questions";

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
  caseText,
  requirementQuestions = [],
  po,
  openQuestions,
}: {
  testCaseId: string;
  comments: CommentWithAuthor[];
  currentUserId: string;
  canComment: boolean;
  canModerate: boolean;
  /** An admin — a PO — who can answer questions. */
  canAnswer?: boolean;
  /**
   * The case's expected result and open questions, for those who edit cases:
   * then each new PO answer asks to be put into them.
   */
  caseText?: CaseText;
  /**
   * The PO questions on the requirements this case verifies: shown among
   * the comments, in time order — they are part of the same conversation.
   */
  requirementQuestions?: RequirementQuestionGroup[];
  /** Who may ask and answer the requirement questions. */
  po?: PoContext;
  /** The case's open questions, kept at the top of its discussion. */
  openQuestions?: { text: string | null; note: string | null; canEdit: boolean };
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);

  /** Start a comment asking the PO the open questions. */
  function askOpenQuestions(questions: string) {
    setBody(`Could you clarify:\n${questions}`);
    composer.current?.focus();
    composer.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // The comment being replied to, and the reply.
  const [answering, setAnswering] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [sendingAnswer, setSendingAnswer] = useState(false);
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  // Each thread together: a comment, then the replies under it.
  const ordered = threaded(comments);
  // Each requirement question goes just before the first case thread that
  // started after it; the rest go last.
  const asked = requirementQuestions
    .flatMap(({ requirement, questions }) => questions.map((question) => ({ requirement, question })))
    .sort((a, b) => a.question.createdAt.localeCompare(b.question.createdAt));
  const askedBefore = new Map<string, typeof asked>();
  const roots = ordered.filter((comment) => !comment.answerToId || !byId.has(comment.answerToId));
  let next = 0;
  for (const root of roots) {
    const startedAt = new Date(root.createdAt).toISOString();
    const due: typeof asked = [];
    while (next < asked.length && asked[next]!.question.createdAt <= startedAt) due.push(asked[next++]!);
    if (due.length) askedBefore.set(root.id, due);
  }
  const askedLast = asked.slice(next);
  const renderAsked = (items: typeof asked) =>
    po
      ? items.map(({ requirement, question }) => (
          <RequirementQuestionItem
            key={question.id}
            testCaseId={testCaseId}
            caseText={caseText}
            question={question}
            openQuestions={requirement.openQuestions}
            po={po}
          />
        ))
      : null;
  const total = comments.length + asked.reduce((sum, item) => sum + 1 + item.question.replies.length, 0);
  // Question id → its latest answer, while the answer is not yet in the case.
  const toApply = caseText ? answersToApply(comments) : new Map<string, string>();
  const promptAfter = new Map([...toApply].map(([questionId, answerId]) => [answerId, questionId]));
  // Answers already dealt with keep a quiet way to update the case from them,
  // after each question's latest answer.
  const latestAnswer = new Map<string, string>();
  if (caseText) {
    for (const comment of comments) {
      if (comment.kind === "ANSWER" && comment.answerToId && !comment.deletedAt) {
        latestAnswer.set(comment.answerToId, comment.id);
      }
    }
  }
  const quietAfter = new Map(
    [...latestAnswer].filter(([questionId]) => !toApply.has(questionId)).map(([questionId, answerId]) => [answerId, questionId]),
  );
  const answersTo = (questionId: string) =>
    comments
      .filter((c) => c.kind === "ANSWER" && c.answerToId === questionId && !c.deletedAt)
      .map((c) => ({ author: c.author.name, body: c.body }));

  async function handleNoChange(questionId: string) {
    try {
      await api.post(`/api/comments/${questionId}/settle`, {});
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function handleAnswer(questionId: string) {
    const trimmed = answer.trim();
    if (!trimmed) return;
    setSendingAnswer(true);
    try {
      await api.post(`/api/test-cases/${testCaseId}/comments`, { body: trimmed, replyToId: questionId });
      setAnswer("");
      setAnswering(null);
      toast.success("Replied — the people in this thread are notified");
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
          {total === 0
            ? "Ask a question or report a fix — QA and developers both post here."
            : `${total} comment${total === 1 ? "" : "s"}`}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {openQuestions && (
          <OpenQuestionsPanel
            testCaseId={testCaseId}
            text={openQuestions.text}
            note={openQuestions.note}
            canEdit={openQuestions.canEdit}
            forPo={canAnswer}
            onAsk={canComment && !canAnswer ? askOpenQuestions : undefined}
          />
        )}
        {total === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No comments yet"
            description="Use this to hand a failure back and forth without editing the test result."
          />
        ) : (
          <ol className="space-y-3">
            {ordered.map((comment) => {
              const withdrawn = Boolean(comment.deletedAt);
              const question = comment.kind === "QUESTION";
              const promptFor = promptAfter.get(comment.id);
              return (
                <Fragment key={comment.id}>
                {renderAsked(askedBefore.get(comment.id) ?? [])}
                <li className={cn("flex items-start gap-3", comment.answerToId && "ml-9")}>
                  <Avatar className="size-7 shrink-0">
                    {comment.author.image && (
                      <AvatarImage src={comment.author.image} alt="" />
                    )}
                    <AvatarFallback className="text-xs">
                      {initials(comment.author.name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1 space-y-1">
                    {/* One plain line: who, their role (it tells QA whether a
                        reply comes from the PO or engineering), when. */}
                    <p className="text-xs text-muted-foreground">
                      <span className="text-sm font-medium text-foreground">{comment.author.name}</span>
                      {" · "}
                      {ROLE_LABELS[toRole(comment.author.role)]}
                      {" · "}
                      {formatDateTime(comment.createdAt)}
                      {comment.kind === "ANSWER" && " · Answer"}
                      {comment.kind === "COMMENT" &&
                        comment.answerToId &&
                        (byId.get(comment.answerToId)?.kind === "QUESTION" ? " · Follow-up" : " · Reply")}
                    </p>
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
                    {question && !withdrawn && (
                      // Where the question stands, in one quiet line; only a
                      // question still waiting is coloured.
                      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        <HelpCircle className="size-3.5" aria-hidden />
                        Question for {comment.questionTo?.name ?? "the PO"}
                        {" · "}
                        {comment.answeredAt ? (
                          "Answered"
                        ) : (
                          <span className="font-medium text-status-blocked">Waiting for an answer</span>
                        )}
                        {comment.settledAt && !toApply.has(comment.id) && (
                          <>
                            {" · "}
                            <span title={comment.settledBy ? `By ${comment.settledBy.name}` : undefined}>
                              {comment.settledChangedCase ? "Added to the case" : "No change to the case"}
                            </span>
                          </>
                        )}
                      </p>
                    )}
                    {!withdrawn && (canComment || (question && canAnswer)) && answering !== comment.id && (
                      <Button
                        variant={question && canAnswer ? "outline" : "ghost"}
                        size="sm"
                        className={cn("mt-1 h-7", !(question && canAnswer) && "-ml-2 px-2 text-muted-foreground")}
                        onClick={() => {
                          setAnswering(comment.id);
                          setAnswer("");
                        }}
                      >
                        <CornerDownRight className="mr-1.5 size-3.5" />
                        {question && canAnswer ? "Answer" : "Reply"}
                      </Button>
                    )}
                    {answering === comment.id && (
                      <div className="mt-2 space-y-2">
                        <Textarea
                          rows={3}
                          autoFocus
                          value={answer}
                          onChange={(event) => setAnswer(event.target.value)}
                          placeholder={
                            question && canAnswer
                              ? "The answer QA can test against — the message, the limit, the rule…"
                              : `Reply to ${comment.author.name}…`
                          }
                          aria-label={question && canAnswer ? "Write the answer" : "Write a reply"}
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
                            {question && canAnswer ? "Send answer" : "Send reply"}
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
                {!promptFor && quietAfter.has(comment.id) && caseText && byId.get(quietAfter.get(comment.id)!) && (
                  <CaseUpdatePrompt
                    quiet
                    testCaseId={testCaseId}
                    source={{ kind: "comment", questionId: quietAfter.get(comment.id)! }}
                    question={byId.get(quietAfter.get(comment.id)!)!.body}
                    answers={answersTo(quietAfter.get(comment.id)!)}
                    caseText={caseText}
                  />
                )}
                {promptFor && caseText && byId.get(promptFor) && (
                  // After the PO's latest answer: the confirmed rule belongs in
                  // the case, which is what testers, reports and the AI read.
                  <CaseUpdatePrompt
                    testCaseId={testCaseId}
                    source={{ kind: "comment", questionId: promptFor }}
                    question={byId.get(promptFor)!.body}
                    answers={answersTo(promptFor)}
                    caseText={caseText}
                    onNoChange={() => handleNoChange(promptFor)}
                  />
                )}
                </Fragment>
              );
            })}
            {renderAsked(askedLast)}
          </ol>
        )}

        {canComment && (
          <div className="space-y-2 border-t pt-4">
            <Textarea
              ref={composer}
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write a comment…"
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

/**
 * Each thread together, oldest thread first: a comment, then the replies
 * under it in the order they came. A reply whose comment is gone stands alone.
 */
function threaded(comments: CommentWithAuthor[]): CommentWithAuthor[] {
  const ids = new Set(comments.map((comment) => comment.id));
  const replies = new Map<string, CommentWithAuthor[]>();
  for (const comment of comments) {
    if (comment.answerToId && ids.has(comment.answerToId)) {
      replies.set(comment.answerToId, [...(replies.get(comment.answerToId) ?? []), comment]);
    }
  }
  return comments
    .filter((comment) => !comment.answerToId || !ids.has(comment.answerToId))
    .flatMap((root) => [root, ...(replies.get(root.id) ?? [])]);
}
