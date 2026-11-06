-- Deleting a test case moves it to the project's Trash instead of erasing it.
-- It stays there, with its history, until restored or deleted forever.

-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedById" TEXT;

-- CreateIndex
CREATE INDEX "TestCase_projectId_deletedAt_idx" ON "TestCase"("projectId", "deletedAt");

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
