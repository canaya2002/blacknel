-- ---------------------------------------------------------------------------
-- 0036_ads_meta_structure.sql — Phase 11 / C50 (Ads pillar: Meta Ads)
--
-- Builds ON the Phase-8 ads model (ads_accounts, ads_spend_daily, ads_alerts)
-- — does NOT duplicate it. C50 adds the campaign→ad-set→ad STRUCTURE layer the
-- Marketing API sync needs, a `conversions` column on the existing daily insight
-- rollup, and seeds the `use_real_meta_ads` flag OFF.
--
-- Insights stay in `ads_spend_daily` (the table reporting/analytics already
-- reads). Structure tables hold the hierarchy (names, status, budgets) the
-- pause/resume/budget actions operate on; they reference `ads_accounts` and
-- carry their own org-scoped RLS.
--
-- `status` is normalized text (active|paused|archived|deleted|pending|unknown)
-- rather than an enum so Google/TikTok statuses (a later batch) don't force an
-- `ALTER TYPE`. The raw platform payload is kept in `raw` jsonb for forward
-- compat. `external_id` is the platform's id (Meta campaign/adset/ad id); the
-- (org, ads_account, external_id) unique key drives idempotent upserts.
--
-- Write-only / additive: CREATE + ALTER ADD COLUMN + INSERT. No DROP, no data
-- loss. Targets tables that exist since 0012/0013.
-- ---------------------------------------------------------------------------

-- ---- ads_campaigns --------------------------------------------------------

CREATE TABLE ads_campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ads_account_id        uuid NOT NULL REFERENCES ads_accounts(id) ON DELETE CASCADE,
  external_id           text NOT NULL,
  name                  text NOT NULL,
  status                text NOT NULL DEFAULT 'unknown',
  objective             text,
  daily_budget_cents    integer,
  lifetime_budget_cents integer,
  currency              text,
  raw                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ads_campaigns_org_account_external_unique
  ON ads_campaigns (organization_id, ads_account_id, external_id);
CREATE INDEX ads_campaigns_account_idx
  ON ads_campaigns (ads_account_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON ads_campaigns TO authenticated;
ALTER TABLE ads_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY ads_campaigns_tenant ON ads_campaigns
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- ads_ad_sets ----------------------------------------------------------

CREATE TABLE ads_ad_sets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ads_account_id        uuid NOT NULL REFERENCES ads_accounts(id) ON DELETE CASCADE,
  campaign_id           uuid REFERENCES ads_campaigns(id) ON DELETE CASCADE,
  external_id           text NOT NULL,
  campaign_external_id  text,
  name                  text NOT NULL,
  status                text NOT NULL DEFAULT 'unknown',
  daily_budget_cents    integer,
  lifetime_budget_cents integer,
  currency              text,
  raw                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ads_ad_sets_org_account_external_unique
  ON ads_ad_sets (organization_id, ads_account_id, external_id);
CREATE INDEX ads_ad_sets_campaign_idx
  ON ads_ad_sets (campaign_id)
  WHERE campaign_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON ads_ad_sets TO authenticated;
ALTER TABLE ads_ad_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY ads_ad_sets_tenant ON ads_ad_sets
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- ads_ads --------------------------------------------------------------

CREATE TABLE ads_ads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ads_account_id        uuid NOT NULL REFERENCES ads_accounts(id) ON DELETE CASCADE,
  ad_set_id             uuid REFERENCES ads_ad_sets(id) ON DELETE CASCADE,
  external_id           text NOT NULL,
  ad_set_external_id    text,
  name                  text NOT NULL,
  status                text NOT NULL DEFAULT 'unknown',
  raw                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ads_ads_org_account_external_unique
  ON ads_ads (organization_id, ads_account_id, external_id);
CREATE INDEX ads_ads_ad_set_idx
  ON ads_ads (ad_set_id)
  WHERE ad_set_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON ads_ads TO authenticated;
ALTER TABLE ads_ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY ads_ads_tenant ON ads_ads
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- ads_spend_daily.conversions ------------------------------------------
-- Insights table already holds spend/impressions/clicks; C50 adds conversions
-- (Meta Marketing API `actions`) so ad_insights is complete. Existing reporting
-- selects explicit columns, so the additive column is safe.

ALTER TABLE ads_spend_daily ADD COLUMN IF NOT EXISTS conversions integer NOT NULL DEFAULT 0;

-- ---- flag seed ------------------------------------------------------------
-- Real Meta Marketing API path is OFF until creds + App Review land. Read fresh
-- per call (fail-closed) like every other use_real_* flag.

INSERT INTO public.app_settings (key, value)
VALUES ('use_real_meta_ads', 'off')
ON CONFLICT (key) DO NOTHING;
