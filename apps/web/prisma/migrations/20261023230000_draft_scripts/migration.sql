-- AlterTable
ALTER TABLE "AutomationScript" ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TestRunItem" ADD COLUMN     "draft" BOOLEAN NOT NULL DEFAULT false;


-- Scripts that have already passed in a run as they are now count as
-- verified; the rest start as drafts. (A run's item code may carry a
-- "sign in first" prefix ahead of the case's own script.)
UPDATE "AutomationScript" s
SET "verifiedAt" = now()
WHERE EXISTS (
  SELECT 1 FROM "TestRunItem" i
  WHERE i."testCaseId" = s."testCaseId"
    AND i.status = 'PASSED'
    AND (i.code = s.code OR right(i.code, length(s.code) + 1) = E'\n' || s.code)
);
