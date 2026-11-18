-- The last run number given out, so a deleted run's number is never reused.
ALTER TABLE "Project" ADD COLUMN "lastRunNumber" INTEGER NOT NULL DEFAULT 0;

UPDATE "Project" p
SET "lastRunNumber" = COALESCE((SELECT MAX(r."number") FROM "TestRun" r WHERE r."projectId" = p."id"), 0);
