-- ✅ NEW: DB-level idempotency for contestGenerator — guarantees no two contests share
-- the same (start_time, stream), so concurrent cron + startup catch-up runs can never
-- create duplicate contests. Prisma P2002 on create is caught in the job as a no-op.
CREATE UNIQUE INDEX "contests_start_time_stream_key" ON "contests"("start_time", "stream");
