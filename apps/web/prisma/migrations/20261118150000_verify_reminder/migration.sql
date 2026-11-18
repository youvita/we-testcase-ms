-- QA reminding the PO to verify a project's requirements.
ALTER TYPE "NotificationKind" ADD VALUE 'REQUIREMENTS_TO_VERIFY';

ALTER TABLE "Notification" ADD COLUMN "projectId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "note" TEXT;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Notification_projectId_kind_createdAt_idx" ON "Notification"("projectId", "kind", "createdAt");
