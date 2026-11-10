-- The PO (an admin) verifies requirements; drafts for unverified ones cannot
-- become test cases. Every requirement starts not verified — existing ones
-- too — so the PO reviews them all.

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

