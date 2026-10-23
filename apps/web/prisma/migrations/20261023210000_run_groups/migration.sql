-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "inOrder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "setupTcId" TEXT,
ADD COLUMN     "setupTestCaseId" TEXT;

