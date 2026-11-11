-- The project's single owner becomes its product owner (PO): an admin who
-- receives comments on its cases. QA work on a project as people in charge.

-- An owner who is not an admin keeps their access as one of the people in charge.
INSERT INTO "ProjectMember" ("projectId", "userId", "createdAt")
SELECT p."id", p."qaOwnerId", CURRENT_TIMESTAMP
FROM "Project" p
JOIN "User" u ON u."id" = p."qaOwnerId"
WHERE u."role" <> 'ADMIN'
ON CONFLICT DO NOTHING;

-- ...and the project waits for a PO to be chosen.
UPDATE "Project" p
SET "qaOwnerId" = NULL
FROM "User" u
WHERE u."id" = p."qaOwnerId" AND u."role" <> 'ADMIN';

ALTER TABLE "Project" RENAME COLUMN "qaOwnerId" TO "productOwnerId";
ALTER TABLE "Project" RENAME CONSTRAINT "Project_qaOwnerId_fkey" TO "Project_productOwnerId_fkey";
ALTER INDEX "Project_qaOwnerId_idx" RENAME TO "Project_productOwnerId_idx";
