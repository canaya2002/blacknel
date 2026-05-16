-- ---------------------------------------------------------------------------
-- 0009_publishing_retries.sql — Phase 6 / Commit 20a
--
-- Adds retry bookkeeping to `post_targets` for the publish-job
-- (Commit 20a):
--
--   * retry_count int NOT NULL DEFAULT 0
--     — incremented per transient failure. The job stops retrying
--       at 3 (state → 'failed' permanent).
--
--   * next_retry_at timestamptz (nullable)
--     — set when the dispatch fails transiently. The cron picks
--       up failed rows where `next_retry_at <= now()`.
--
--   * Partial index for the retry-selector hot path:
--     `WHERE status = 'failed' AND retry_count < 3`. The cron's
--     dispatch-failed-retries query scans this slice in O(matching
--     rows) instead of full table.
--
-- Backfill: `post_targets.idempotency_key` was nullable for the
-- pre-Commit-20 rows where the publish-job hadn't run. Commit 20a
-- requires every target to carry a key BEFORE the connector call
-- — so we backfill NULLs with fresh UUIDs in-place. The schema
-- column remains nullable for now (FRESH rows still arrive
-- without a key — the job stamps one before dispatching), but
-- the JSDoc invariant is "no NULL by the time `dispatchOneTarget`
-- runs".
--
-- All changes are aditive + zero-impact on existing rows. The
-- partial index is cheap (only failed rows). Backfill of
-- idempotency_key is a one-time UUID per affected row.
-- ---------------------------------------------------------------------------

ALTER TABLE post_targets
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE post_targets
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

-- Backfill the idempotency_key for any historical rows that didn't
-- carry one. New rows from Commit 20a onward get one at insert
-- time via the orchestrator (`createPost` populates it now).
UPDATE post_targets
SET idempotency_key = gen_random_uuid()::text
WHERE idempotency_key IS NULL;

-- Retry-selector hot-path index. Partial — only the slice the cron
-- scans every tick. `next_retry_at` deliberately NOT included in
-- the index because the planner does an index scan + filter
-- which is cheap when the slice is small (≈failed rows).
CREATE INDEX IF NOT EXISTS post_targets_retry_pending_idx
  ON post_targets (next_retry_at)
  WHERE status = 'failed' AND retry_count < 3;
