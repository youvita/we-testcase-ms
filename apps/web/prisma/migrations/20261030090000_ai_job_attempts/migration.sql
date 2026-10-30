-- How many times an AI job has started. Jobs are now taken back after a
-- server restart and started over; this lets one that keeps being interrupted
-- be failed instead of retried forever.
ALTER TABLE "AiJob" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
