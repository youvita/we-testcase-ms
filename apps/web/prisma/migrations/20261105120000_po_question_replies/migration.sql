-- A question for the PO becomes a conversation: the PO's answers and QA's
-- follow-ups are replies under it, and either side can mark it resolved.
-- Existing answers are copied in as each question's first reply before the
-- answer columns go.

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'QUESTION_REPLIED';

-- CreateTable
CREATE TABLE "PoQuestionReply" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "questionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "PoQuestionReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoQuestionReply_questionId_createdAt_idx" ON "PoQuestionReply"("questionId", "createdAt");

-- AddForeignKey
ALTER TABLE "PoQuestionReply" ADD CONSTRAINT "PoQuestionReply_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "PoQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoQuestionReply" ADD CONSTRAINT "PoQuestionReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: each answer becomes the first reply, by whoever answered, when
-- they answered.
INSERT INTO "PoQuestionReply" ("id", "body", "createdAt", "questionId", "authorId")
SELECT 'mig' || md5(q."id" || '-answer'), q."answer", coalesce(q."answeredAt", q."createdAt"), q."id", q."answeredById"
  FROM "PoQuestion" q
 WHERE q."answer" IS NOT NULL AND q."answeredById" IS NOT NULL;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "replyId" TEXT;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "PoQuestionReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: "answered" notifications point at the reply they announced.
UPDATE "Notification" n
   SET "replyId" = 'mig' || md5(n."questionId" || '-answer')
 WHERE n."kind" = 'QUESTION_ANSWERED'
   AND n."questionId" IS NOT NULL
   AND EXISTS (SELECT 1 FROM "PoQuestionReply" r WHERE r."id" = 'mig' || md5(n."questionId" || '-answer'));

-- DropForeignKey
ALTER TABLE "PoQuestion" DROP CONSTRAINT "PoQuestion_answeredById_fkey";

-- AlterTable
ALTER TABLE "PoQuestion" DROP COLUMN "answer",
DROP COLUMN "answeredById",
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" TEXT;

-- AddForeignKey
ALTER TABLE "PoQuestion" ADD CONSTRAINT "PoQuestion_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
