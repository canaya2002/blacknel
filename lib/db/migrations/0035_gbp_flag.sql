-- =============================================================================
-- 0035_gbp_flag.sql — Phase 11 / C49. WRITE ONLY (Carlos applies).
--
-- Google Business Profile reviews pillar on the existing connectors framework.
-- NO new tables: reviews + review_responses already exist (0006/0020) and accept
-- GBP rows (platform-agnostic, connected_account_id linkage, partial-unique dedup
-- on (org, platform, external_review_id)). token_expires_at exists from 0033.
-- Just seed the real-vs-mock flag (default OFF), flipped with
-- `pnpm db:flag use_real_gbp on/off`. Idempotent.
-- =============================================================================

INSERT INTO public.app_settings (key, value) VALUES
  ('use_real_gbp', 'off')
ON CONFLICT (key) DO NOTHING;
