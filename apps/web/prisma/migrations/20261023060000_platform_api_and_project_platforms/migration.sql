-- API moves from a test type to a platform, and projects declare their platforms.
--
-- Hand-written: Prisma would drop the TestType "API" value and fail on any row
-- using it. Instead those cases become platform API / type FUNCTIONAL — "API"
-- always described where the test ran, not what kind of test it was.
--
-- Both enums are rebuilt (rename, create, cast, drop) rather than altered with
-- ADD VALUE, which cannot be used inside the transaction that adds it.

-- 1. Platform gains API, between WEB and IOS -------------------------------

ALTER TYPE "Platform" RENAME TO "Platform_old";
CREATE TYPE "Platform" AS ENUM ('WEB', 'API', 'IOS', 'ANDROID');

ALTER TABLE "TestCase" ALTER COLUMN "platform" DROP DEFAULT;
ALTER TABLE "TestCase" ALTER COLUMN "platform" TYPE "Platform" USING ("platform"::text::"Platform");
ALTER TABLE "TestCase" ALTER COLUMN "platform" SET DEFAULT 'WEB';

ALTER TABLE "TestCaseDraft" ALTER COLUMN "platform" DROP DEFAULT;
ALTER TABLE "TestCaseDraft" ALTER COLUMN "platform" TYPE "Platform" USING ("platform"::text::"Platform");
ALTER TABLE "TestCaseDraft" ALTER COLUMN "platform" SET DEFAULT 'WEB';

DROP TYPE "Platform_old";

-- 2. Cases typed API become platform API ----------------------------------

UPDATE "TestCase" SET "platform" = 'API', "testType" = 'FUNCTIONAL' WHERE "testType" = 'API';
UPDATE "TestCaseDraft" SET "platform" = 'API', "testType" = 'FUNCTIONAL' WHERE "testType" = 'API';

-- 3. TestType loses API ----------------------------------------------------

ALTER TYPE "TestType" RENAME TO "TestType_old";
CREATE TYPE "TestType" AS ENUM ('FUNCTIONAL', 'UI', 'NEGATIVE', 'INTEGRATION', 'REGRESSION', 'PERFORMANCE', 'SECURITY', 'USABILITY', 'COMPATIBILITY');

ALTER TABLE "TestCase" ALTER COLUMN "testType" DROP DEFAULT;
ALTER TABLE "TestCase" ALTER COLUMN "testType" TYPE "TestType" USING ("testType"::text::"TestType");
ALTER TABLE "TestCase" ALTER COLUMN "testType" SET DEFAULT 'FUNCTIONAL';

ALTER TABLE "TestCaseDraft" ALTER COLUMN "testType" DROP DEFAULT;
ALTER TABLE "TestCaseDraft" ALTER COLUMN "testType" TYPE "TestType" USING ("testType"::text::"TestType");
ALTER TABLE "TestCaseDraft" ALTER COLUMN "testType" SET DEFAULT 'FUNCTIONAL';

DROP TYPE "TestType_old";

-- 4. Projects declare their platforms --------------------------------------

ALTER TABLE "Project" ADD COLUMN "platforms" "Platform"[] DEFAULT ARRAY['WEB']::"Platform"[];

-- Existing projects get whatever their cases already use, in enum order;
-- a project with no cases keeps the WEB default.
UPDATE "Project" p
SET "platforms" = sub.platforms
FROM (
  SELECT "projectId", array_agg(DISTINCT "platform" ORDER BY "platform") AS platforms
  FROM "TestCase"
  GROUP BY "projectId"
) sub
WHERE sub."projectId" = p.id;
