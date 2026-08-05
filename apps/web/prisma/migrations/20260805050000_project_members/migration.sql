-- People in charge of a project, alongside its single QA owner.
--
-- Also the project's access list: see lib/project-access.ts. Membership is a
-- plain join table rather than a role column because "in charge" says nothing
-- about what someone may do — that still comes from their user role.
--
-- No backfill: existing projects keep their QA owner and creator, who both
-- retain access on their own, so nobody is locked out by this migration.
CREATE TABLE "ProjectMember" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- Answers "which projects can this person open?" without scanning the table.
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- Cascades: removing a project or a user drops their membership rows. Neither
-- carries history worth keeping once its owner is gone.
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
