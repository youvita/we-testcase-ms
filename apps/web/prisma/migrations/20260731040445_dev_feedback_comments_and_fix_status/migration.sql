-- CreateEnum
CREATE TYPE "FixStatus" AS ENUM ('NONE', 'INVESTIGATING', 'FIXED', 'WONT_FIX', 'NOT_A_BUG');

-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "fixStatus" "FixStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "fixStatusAt" TIMESTAMP(3),
ADD COLUMN     "fixStatusById" TEXT;

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Comment_testCaseId_createdAt_idx" ON "Comment"("testCaseId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_authorId_idx" ON "Comment"("authorId");

-- CreateIndex
CREATE INDEX "TestCase_projectId_fixStatus_idx" ON "TestCase"("projectId", "fixStatus");

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_fixStatusById_fkey" FOREIGN KEY ("fixStatusById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
