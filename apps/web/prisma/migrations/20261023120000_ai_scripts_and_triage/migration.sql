-- CreateEnum
CREATE TYPE "TestRunPurpose" AS ENUM ('RUN', 'SCRIPT_CHECK');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiJobKind" ADD VALUE 'WRITE_SCRIPT';
ALTER TYPE "AiJobKind" ADD VALUE 'TRIAGE_FAILURE';

-- AlterTable
ALTER TABLE "AiJob" ADD COLUMN     "result" JSONB;

-- AlterTable
ALTER TABLE "TestRun" ADD COLUMN     "purpose" "TestRunPurpose" NOT NULL DEFAULT 'RUN',
ALTER COLUMN "number" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TestRunItem" ADD COLUMN     "triage" JSONB,
ADD COLUMN     "triagedAt" TIMESTAMP(3);

