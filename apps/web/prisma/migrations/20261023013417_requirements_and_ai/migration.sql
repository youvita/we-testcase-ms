-- CreateEnum
CREATE TYPE "RequirementDocKind" AS ENUM ('PRD', 'FRD', 'OTHER');

-- CreateEnum
CREATE TYPE "AiJobKind" AS ENUM ('EXTRACT_REQUIREMENTS', 'GENERATE_TEST_CASES');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "ClaudeConnection" (
    "userId" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaudeConnection_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RequirementDoc" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "RequirementDocKind" NOT NULL DEFAULT 'PRD',
    "fileName" TEXT,
    "content" TEXT NOT NULL,
    "charCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "RequirementDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acceptanceCriteria" TEXT,
    "openQuestions" TEXT,
    "section" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "docId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseRequirement" (
    "testCaseId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCaseRequirement_pkey" PRIMARY KEY ("testCaseId","requirementId")
);

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "kind" "AiJobKind" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'QUEUED',
    "input" JSONB,
    "progressDone" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "projectId" TEXT NOT NULL,
    "docId" TEXT,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseDraft" (
    "id" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "moduleName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "preconditions" TEXT,
    "steps" TEXT,
    "expectedResult" TEXT,
    "testType" "TestType" NOT NULL DEFAULT 'FUNCTIONAL',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "platform" "Platform" NOT NULL DEFAULT 'WEB',
    "requirementIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "testCaseId" TEXT,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT,

    CONSTRAINT "TestCaseDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequirementDoc_projectId_createdAt_idx" ON "RequirementDoc"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Requirement_projectId_position_idx" ON "Requirement"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_docId_code_key" ON "Requirement"("docId", "code");

-- CreateIndex
CREATE INDEX "TestCaseRequirement_requirementId_idx" ON "TestCaseRequirement"("requirementId");

-- CreateIndex
CREATE INDEX "AiJob_projectId_createdAt_idx" ON "AiJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_status_idx" ON "AiJob"("status");

-- CreateIndex
CREATE INDEX "TestCaseDraft_projectId_status_idx" ON "TestCaseDraft"("projectId", "status");

-- AddForeignKey
ALTER TABLE "ClaudeConnection" ADD CONSTRAINT "ClaudeConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementDoc" ADD CONSTRAINT "RequirementDoc_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementDoc" ADD CONSTRAINT "RequirementDoc_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_docId_fkey" FOREIGN KEY ("docId") REFERENCES "RequirementDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseRequirement" ADD CONSTRAINT "TestCaseRequirement_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseRequirement" ADD CONSTRAINT "TestCaseRequirement_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_docId_fkey" FOREIGN KEY ("docId") REFERENCES "RequirementDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseDraft" ADD CONSTRAINT "TestCaseDraft_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseDraft" ADD CONSTRAINT "TestCaseDraft_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseDraft" ADD CONSTRAINT "TestCaseDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseDraft" ADD CONSTRAINT "TestCaseDraft_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
