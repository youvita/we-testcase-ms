-- CreateEnum
CREATE TYPE "TestType" AS ENUM ('FUNCTIONAL', 'UI', 'API', 'NEGATIVE', 'INTEGRATION', 'REGRESSION', 'PERFORMANCE', 'SECURITY', 'USABILITY', 'COMPATIBILITY');

-- DropIndex
DROP INDEX "TestCase_projectId_priority_idx";

-- AlterTable
ALTER TABLE "TestCase" DROP COLUMN "priority",
ADD COLUMN     "testType" "TestType" NOT NULL DEFAULT 'FUNCTIONAL';

-- DropEnum
DROP TYPE "Priority";

-- CreateIndex
CREATE INDEX "TestCase_projectId_testType_idx" ON "TestCase"("projectId", "testType");

