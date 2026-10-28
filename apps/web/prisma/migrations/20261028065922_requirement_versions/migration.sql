-- CreateEnum
CREATE TYPE "RequirementChange" AS ENUM ('ADDED', 'CHANGED', 'UNCHANGED', 'MISSING');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "change" "RequirementChange",
ADD COLUMN     "changedInVersion" INTEGER,
ADD COLUMN     "possibleMatchId" TEXT,
ADD COLUMN     "previous" JSONB,
ADD COLUMN     "status" "RequirementStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "RequirementDoc" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "RequirementDocVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileName" TEXT,
    "content" TEXT NOT NULL,
    "charCount" INTEGER NOT NULL,
    "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "docId" TEXT NOT NULL,
    "replacedById" TEXT NOT NULL,

    CONSTRAINT "RequirementDocVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequirementDocVersion_docId_version_key" ON "RequirementDocVersion"("docId", "version");

-- AddForeignKey
ALTER TABLE "RequirementDocVersion" ADD CONSTRAINT "RequirementDocVersion_docId_fkey" FOREIGN KEY ("docId") REFERENCES "RequirementDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementDocVersion" ADD CONSTRAINT "RequirementDocVersion_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_possibleMatchId_fkey" FOREIGN KEY ("possibleMatchId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
