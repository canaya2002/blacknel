-- ---------------------------------------------------------------------------
-- 0012_ads_intelligence.sql — Phase 8 / Commit 28
--
-- Two tables for the Ads Intelligence module:
--
--   * ads_accounts — one row per (org, brand?, platform,
--     external_account_id) connected ad account. Mock today;
--     real OAuth wiring at Phase 11. `status` is the
--     connection lifecycle (`connected` → `disconnected`
--     terminal). `metadata` jsonb stores provider-specific
--     bits the producer reads but the dashboard doesn't show.
--
--   * ads_spend_daily — denormalized daily rollup. One row per
--     (org, ads_account, platform_campaign_id, date, currency).
--     Stores BOTH `spend_cents` (native currency the platform
--     reported in) AND `spend_usd_cents` (computed at-insert
--     via lib/ads/fx-rates.ts to_usd_cents). Historical USD
--     values stay frozen even when FX rates update — that's
--     the correct semantics (see fx-rates.ts JSDoc).
--
--     `platform_campaign_id` is the EXTERNAL id from Google
--     Ads / Meta; it does NOT join to `campaigns.id` (our
--     internal table). Phase-12 polish may add a mapping table
--     so cross-platform campaign joins become possible.
--
-- The cron `lib/jobs/ads-sync.ts` upserts daily (last 2d
-- window so late-arriving attribution doesn't lose data).
--
-- Per the Phase-8 charter rule, this migration is ADDITIVE
-- only — does NOT alter any Phase 1-7 table.
-- ---------------------------------------------------------------------------

-- ---- ENUMS ----------------------------------------------------------------

CREATE TYPE ads_platform AS ENUM ('google', 'meta');

CREATE TYPE ads_account_status AS ENUM (
  'connected',
  'disconnected',
  'error'
);

-- ---- ads_accounts ---------------------------------------------------------

CREATE TABLE ads_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id             uuid REFERENCES brands(id) ON DELETE SET NULL,
  platform             ads_platform NOT NULL,
  external_account_id  text NOT NULL,
  account_name         text,
  currency             text NOT NULL DEFAULT 'USD',
  status               ads_account_status NOT NULL DEFAULT 'connected',
  connected_at         timestamptz NOT NULL DEFAULT now(),
  last_sync_at         timestamptz,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- One row per (org, platform, external_account_id) — re-
  -- connecting flips status='connected' on the existing row.
  CONSTRAINT ads_accounts_org_platform_external_unique
    UNIQUE (organization_id, platform, external_account_id)
);

CREATE INDEX ads_accounts_org_status_idx
  ON ads_accounts (organization_id, status);

CREATE INDEX ads_accounts_brand_idx
  ON ads_accounts (brand_id)
  WHERE brand_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON ads_accounts TO authenticated;
ALTER TABLE ads_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ads_accounts_tenant ON ads_accounts
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- ads_spend_daily ------------------------------------------------------

CREATE TABLE ads_spend_daily (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ads_account_id        uuid NOT NULL REFERENCES ads_accounts(id) ON DELETE CASCADE,
  platform_campaign_id  text NOT NULL,
  date                  date NOT NULL,
  impressions           integer NOT NULL DEFAULT 0,
  clicks                integer NOT NULL DEFAULT 0,
  -- Native currency cents. Provider reports in this.
  spend_cents           integer NOT NULL DEFAULT 0,
  -- USD-converted cents, computed at insert via fx-rates.ts.
  -- Frozen historically — does NOT recompute when FX changes.
  spend_usd_cents       integer NOT NULL DEFAULT 0,
  currency              text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ads_spend_daily_unique
    UNIQUE (organization_id, ads_account_id, platform_campaign_id, date, currency)
);

CREATE INDEX ads_spend_daily_org_date_idx
  ON ads_spend_daily (organization_id, date DESC);

CREATE INDEX ads_spend_daily_account_date_idx
  ON ads_spend_daily (ads_account_id, date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON ads_spend_daily TO authenticated;
ALTER TABLE ads_spend_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY ads_spend_daily_tenant ON ads_spend_daily
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
