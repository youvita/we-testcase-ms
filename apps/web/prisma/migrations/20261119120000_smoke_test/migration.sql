-- A project's smoke test: its automated cases in order, and the case that signs in.
ALTER TABLE "TestCase" ADD COLUMN "smokePosition" INTEGER;
CREATE INDEX "TestCase_projectId_smokePosition_idx" ON "TestCase"("projectId", "smokePosition");

ALTER TABLE "Project" ADD COLUMN "smokeSignInTestCaseId" TEXT;
ALTER TABLE "Project" ADD CONSTRAINT "Project_smokeSignInTestCaseId_fkey" FOREIGN KEY ("smokeSignInTestCaseId") REFERENCES "TestCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TestRun" ADD COLUMN "smoke" BOOLEAN NOT NULL DEFAULT false;
