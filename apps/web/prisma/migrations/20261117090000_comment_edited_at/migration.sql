-- When a post's author last changed its text.
ALTER TABLE "Comment" ADD COLUMN "editedAt" TIMESTAMP(3);
