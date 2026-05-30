-- ---------------------------------------------------------------------------
-- 0038_analytics_post_insights_branding.sql — Phase 11 / C52 (Analytics + reports)
--
-- Two additive concerns for the analytics + white-label-reports pillar:
--   1. post_insights — per published post-target engagement (reach/impressions/
--      likes/comments/shares/engagement), the data the analytics layer was
--      missing (we published without measuring). One row per post_target,
--      upserted each sync (latest snapshot). Org-scoped RLS.
--   2. organizations branding — display_name + logo_url + primary/secondary
--      color for white-label PDF reports (the agency differentiator). Nullable;
--      code falls back to Blacknel defaults.
--
-- Write-only / additive: CREATE + ADD COLUMN. No DROP, no data loss.
-- ---------------------------------------------------------------------------

-- ---- post_insights --------------------------------------------------------

CREATE TABLE post_insights (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  post_target_id   uuid NOT NULL REFERENCES post_targets(id) ON DELETE CASCADE,
  platform         text NOT NULL,
  external_post_id text NOT NULL,
  reach            integer NOT NULL DEFAULT 0,
  impressions      integer NOT NULL DEFAULT 0,
  likes            integer NOT NULL DEFAULT 0,
  comments         integer NOT NULL DEFAULT 0,
  shares           integer NOT NULL DEFAULT 0,
  engagement       integer NOT NULL DEFAULT 0,
  -- Denormalized parent post_targets.published_at so analytics can bucket
  -- engagement by post date without a join.
  posted_at        timestamptz,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One insights snapshot per target — re-sync updates in place (idempotent).
CREATE UNIQUE INDEX post_insights_org_target_unique
  ON post_insights (organization_id, post_target_id);
CREATE INDEX post_insights_org_platform_posted_idx
  ON post_insights (organization_id, platform, posted_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON post_insights TO authenticated;
ALTER TABLE post_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY post_insights_tenant ON post_insights
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- organizations branding (white-label) ---------------------------------
-- Nullable; the branding resolver applies Blacknel defaults when unset.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS display_name    text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url        text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_color   text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS secondary_color text;
