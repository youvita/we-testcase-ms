-- CreateEnum
CREATE TYPE "CommentKind" AS ENUM ('COMMENT', 'PO_QUESTION');

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "kind" "CommentKind" NOT NULL DEFAULT 'COMMENT';
