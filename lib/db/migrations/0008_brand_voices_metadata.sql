-- ---------------------------------------------------------------------------
-- 0008_brand_voices_metadata.sql — Phase 6 / Commit 19c.3
--
-- Adds the `metadata jsonb` column to `brand_voices` to carry the
-- approval-rules structure documented in
-- `lib/db/schema/brand-voices.ts` (D-19-1):
--
-- metadata.approvalRules?: {
--   requireApprovalForPosts?: boolean,
--   requireApprovalForPostsOnPlatforms?: PlatformCode[],
--   requireApprovalForCampaignTypes?: CampaignGoal[]
-- }
--
-- The original spec for Commit 19c.3 assumed this column already
-- existed; the C17 schema (`0001_schema.sql`) doesn't include it. This
-- micro-migration closes that gap with zero behavior change for
-- existing rows — the default `'{}'::jsonb` value is semantically
-- "no rules", which matches the Phase-6 default.
--
-- No new index — approvalRules is read on the schedule-action path
-- only, alongside the brand_voice the post's brand references.
-- ---------------------------------------------------------------------------

ALTER TABLE brand_voices
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
