-- What the PO still has to confirm about a case, kept beside it instead of as
-- "(confirm with PO)" at the end of its expected result. Older text keeps its
-- markers; they are split out when a draft is shown or accepted.

-- AlterTable
ALTER TABLE "TestCaseDraft" ADD COLUMN     "openQuestions" TEXT;

-- AlterTable
ALTER TABLE "TestCase" ADD COLUMN     "openQuestions" TEXT;
