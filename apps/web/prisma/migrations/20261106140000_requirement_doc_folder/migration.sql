-- AlterTable
ALTER TABLE "RequirementDoc" ADD COLUMN     "folder" TEXT;

-- CreateIndex
CREATE INDEX "RequirementDoc_projectId_folder_idx" ON "RequirementDoc"("projectId", "folder");

