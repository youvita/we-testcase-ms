-- CreateEnum
CREATE TYPE "TestRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunItemStatus" AS ENUM ('QUEUED', 'PASSED', 'FAILED', 'ERROR', 'SKIPPED');

-- CreateTable
CREATE TABLE "RunEnvironment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webBaseUrl" TEXT,
    "apiBaseUrl" TEXT,
    "variablesSealed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "RunEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationScript" (
    "testCaseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "AutomationScript_pkey" PRIMARY KEY ("testCaseId")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "TestRunStatus" NOT NULL DEFAULT 'QUEUED',
    "recordResults" BOOLEAN NOT NULL DEFAULT true,
    "environmentName" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errored" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "runnerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRunItem" (
    "id" TEXT NOT NULL,
    "status" "RunItemStatus" NOT NULL DEFAULT 'QUEUED',
    "position" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "error" TEXT,
    "log" TEXT,
    "artifacts" JSONB,
    "code" TEXT NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "runId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "executionId" TEXT,

    CONSTRAINT "TestRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunEnvironment_projectId_name_key" ON "RunEnvironment"("projectId", "name");

-- CreateIndex
CREATE INDEX "TestRun_status_createdAt_idx" ON "TestRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TestRun_projectId_number_key" ON "TestRun"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "TestRunItem_executionId_key" ON "TestRunItem"("executionId");

-- CreateIndex
CREATE INDEX "TestRunItem_runId_position_idx" ON "TestRunItem"("runId", "position");

-- CreateIndex
CREATE INDEX "TestRunItem_testCaseId_idx" ON "TestRunItem"("testCaseId");

-- AddForeignKey
ALTER TABLE "RunEnvironment" ADD CONSTRAINT "RunEnvironment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationScript" ADD CONSTRAINT "AutomationScript_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationScript" ADD CONSTRAINT "AutomationScript_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "RunEnvironment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunItem" ADD CONSTRAINT "TestRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunItem" ADD CONSTRAINT "TestRunItem_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunItem" ADD CONSTRAINT "TestRunItem_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "TestExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

