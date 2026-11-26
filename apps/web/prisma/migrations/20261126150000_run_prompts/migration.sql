-- Scripts can ask a person for a value while they run (an OTP, say).
ALTER TABLE "TestRun" ADD COLUMN "askToken" TEXT;

CREATE TABLE "RunPrompt" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answerSealed" TEXT,
    "answeredAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId" TEXT NOT NULL,

    CONSTRAINT "RunPrompt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RunPrompt_runId_idx" ON "RunPrompt"("runId");

ALTER TABLE "RunPrompt" ADD CONSTRAINT "RunPrompt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
