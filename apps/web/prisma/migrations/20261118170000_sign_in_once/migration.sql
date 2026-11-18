-- Sign in once for a run and share it, rather than before each case.
ALTER TABLE "TestRun" ADD COLUMN "signInOnce" BOOLEAN NOT NULL DEFAULT false;
