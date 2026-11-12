-- Attachments on discussion posts, beside those on recorded results.
ALTER TABLE "Attachment" ALTER COLUMN "executionId" DROP NOT NULL;
ALTER TABLE "Attachment" ADD COLUMN "commentId" TEXT;

ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_commentId_fkey"
  FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Attachment_commentId_idx" ON "Attachment"("commentId");

-- Exactly one parent: a result or a post.
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_one_parent"
  CHECK (("executionId" IS NULL) <> ("commentId" IS NULL));
