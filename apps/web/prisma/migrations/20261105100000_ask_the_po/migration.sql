-- Asking the PO on a case: questions and answers are comments of their own
-- kind, and whoever is asked or answered gets an in-app notification.

-- CreateEnum
CREATE TYPE "CommentKind" AS ENUM ('COMMENT', 'QUESTION', 'ANSWER');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('QUESTION_ASKED', 'QUESTION_ANSWERED');

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "answerToId" TEXT,
ADD COLUMN     "answeredAt" TIMESTAMP(3),
ADD COLUMN     "kind" "CommentKind" NOT NULL DEFAULT 'COMMENT',
ADD COLUMN     "questionToId" TEXT;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "recipientId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_questionToId_fkey" FOREIGN KEY ("questionToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_answerToId_fkey" FOREIGN KEY ("answerToId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

