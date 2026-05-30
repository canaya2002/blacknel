-- ---------------------------------------------------------------------------
-- 0037_ads_google_tiktok.sql — Phase 11 / C51 (close the Ads pillar)
--
-- Google Ads + TikTok Ads as new concretes over the C50 ads framework. Google
-- already exists in the `ads_platform` enum (Phase-8 mock); only TikTok needs a
-- new enum value. The ads tables (ads_accounts / ads_spend_daily / ads_campaigns
-- / ads_ad_sets / ads_ads) are platform-agnostic since C50 — no new columns.
--
-- Write-only / additive: ADD VALUE + INSERT. No DROP. `ADD VALUE` is committed
-- by this migration before the value is ever used (no use in this file), so the
-- in-transaction restriction does not apply.
-- ---------------------------------------------------------------------------

ALTER TYPE ads_platform ADD VALUE IF NOT EXISTS 'tiktok';

-- Real Google Ads / TikTok Ads API paths OFF until creds + API access land.
-- Read fresh per call (fail-closed) like every other use_real_* flag.

INSERT INTO public.app_settings (key, value)
VALUES ('use_real_google_ads', 'off'), ('use_real_tiktok_ads', 'off')
ON CONFLICT (key) DO NOTHING;
