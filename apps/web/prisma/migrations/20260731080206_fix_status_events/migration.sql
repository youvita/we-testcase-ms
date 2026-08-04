-- CreateTable
CREATE TABLE "FixStatusEvent" (
    "id" TEXT NOT NULL,
    "fixStatus" "FixStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "testCaseId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "FixStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixStatusEvent_testCaseId_createdAt_idx" ON "FixStatusEvent"("testCaseId", "createdAt");

-- AddForeignKey
ALTER TABLE "FixStatusEvent" ADD CONSTRAINT "FixStatusEvent_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixStatusEvent" ADD CONSTRAINT "FixStatusEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
