-- A PO's answer on a case prompts QA to put it into the case's text; this
-- records that they did, or that no change was needed.

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN "settledAt" TIMESTAMP(3),
ADD COLUMN "settledById" TEXT,
ADD COLUMN "settledChangedCase" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
