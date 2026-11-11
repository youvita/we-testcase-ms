-- A linked requirement changed after the test case was written.
ALTER TABLE "TestCaseRequirement" ADD COLUMN "requirementChangedAt" TIMESTAMP(3);

CREATE INDEX "TestCaseRequirement_testCaseId_requirementChangedAt_idx" ON "TestCaseRequirement"("testCaseId", "requirementChangedAt");
