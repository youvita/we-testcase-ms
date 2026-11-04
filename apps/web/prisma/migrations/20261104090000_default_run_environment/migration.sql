-- A project's default run environment, and the environment each result was
-- tested on.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "defaultEnvironmentId" TEXT;

-- AlterTable
ALTER TABLE "TestExecution" ADD COLUMN     "environmentName" TEXT;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_defaultEnvironmentId_fkey" FOREIGN KEY ("defaultEnvironmentId") REFERENCES "RunEnvironment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: a project labelled "UAT" that has a run environment named UAT
-- defaults to it, and the label — now said by the default — is cleared.
UPDATE "Project" p
SET "defaultEnvironmentId" = r."id", "environment" = NULL
FROM "RunEnvironment" r
WHERE r."projectId" = p."id" AND r."name" = btrim(p."environment");

-- A project with exactly one run environment defaults to it. Its label, if
-- any, names something else, so it stays.
UPDATE "Project" p
SET "defaultEnvironmentId" = (SELECT r."id" FROM "RunEnvironment" r WHERE r."projectId" = p."id")
WHERE p."defaultEnvironmentId" IS NULL
  AND (SELECT count(*) FROM "RunEnvironment" r WHERE r."projectId" = p."id") = 1;

-- Results recorded by an automated run were tested on that run's environment.
UPDATE "TestExecution" e
SET "environmentName" = r."environmentName"
FROM "TestRunItem" i
JOIN "TestRun" r ON r."id" = i."runId"
WHERE i."executionId" = e."id";
