-- Simpler discussion: no naming a reader; a new comment goes to the PO instead.
ALTER TYPE "NotificationKind" RENAME VALUE 'COMMENT_MENTIONED' TO 'COMMENT_POSTED';

ALTER TABLE "Comment" DROP CONSTRAINT "Comment_mentionToId_fkey";
ALTER TABLE "Comment" DROP COLUMN "mentionToId";
