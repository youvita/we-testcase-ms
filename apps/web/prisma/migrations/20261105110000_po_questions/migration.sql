-- Questions for the PO about requirements and review drafts, which have no
-- discussion of their own; notifications can now point at one.

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "questionId" TEXT,
ALTER COLUMN "testCaseId" DROP NOT NULL,
ALTER COLUMN "commentId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PoQuestion" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "requirementId" TEXT,
    "draftId" TEXT,
    "askerId" TEXT NOT NULL,
    "questionToId" TEXT,
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "answeredById" TEXT,

    CONSTRAINT "PoQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoQuestion_projectId_createdAt_idx" ON "PoQuestion"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "PoQuestion_requirementId_idx" ON "PoQuestion"("requirementId");

-- CreateIndex
CREATE INDEX "PoQuestion_draftId_idx" ON "PoQuestion"("draftId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "PoQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoQuestion" ADD CONSTRAINT "PoQuestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoQuestion" ADD CONSTRAINT "PoQuestion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoQuestion" ADD CONSTRAINT "PoQuestion_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "TestCaseDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoQuestion" ADD CONSTRAINT "PoQuestion_askerId_fkey" FOREIGN KEY ("askerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoQuestion" ADD CONSTRAINT "PoQuestion_questionToId_fkey" FOREIGN KEY ("questionToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoQuestion" ADD CONSTRAINT "PoQuestion_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

