-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "subModule" TEXT;

-- AlterTable
ALTER TABLE "TestCaseDraft" ADD COLUMN     "subModule" TEXT;

-- DropIndex
DROP INDEX "TestCase_moduleId_idx";

-- CreateIndex
CREATE INDEX "TestCase_moduleId_subModule_idx" ON "TestCase"("moduleId", "subModule");
