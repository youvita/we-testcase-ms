-- Replies to any comment, and naming one reader on a comment.
ALTER TYPE "NotificationKind" ADD VALUE 'COMMENT_REPLIED';
ALTER TYPE "NotificationKind" ADD VALUE 'COMMENT_MENTIONED';

ALTER TABLE "Comment" ADD COLUMN "mentionToId" TEXT;

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_mentionToId_fkey" FOREIGN KEY ("mentionToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
