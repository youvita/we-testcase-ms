-- An Admin base URL per environment, and which site (Web or Admin) a Web
-- case opens.
CREATE TYPE "WebSite" AS ENUM ('WEB', 'ADMIN');

ALTER TABLE "RunEnvironment" ADD COLUMN "adminBaseUrl" TEXT;
ALTER TABLE "TestCase" ADD COLUMN "site" "WebSite" NOT NULL DEFAULT 'WEB';
ALTER TABLE "TestCaseDraft" ADD COLUMN "site" "WebSite" NOT NULL DEFAULT 'WEB';
ALTER TABLE "TestRunItem" ADD COLUMN "site" "WebSite" NOT NULL DEFAULT 'WEB';
