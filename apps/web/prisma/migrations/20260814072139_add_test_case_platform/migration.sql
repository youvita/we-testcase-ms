-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('WEB', 'IOS', 'ANDROID');

-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "platform" "Platform" NOT NULL DEFAULT 'WEB';
