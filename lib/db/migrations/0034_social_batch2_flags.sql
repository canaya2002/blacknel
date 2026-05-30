-- =============================================================================
-- 0034_social_batch2_flags.sql — Phase 11 / C47. WRITE ONLY (Carlos applies).
--
-- Social connectors batch 2 (LinkedIn, TikTok, X, YouTube) on the existing
-- connectors framework — NO new tables (connected_accounts already supports any
-- provider; tokens in oauth_tokens_encrypted; token_expires_at from 0033). Just
-- seed the four per-platform real-vs-mock flags (default OFF), flipped with
-- `pnpm db:flag use_real_<platform> on/off`. Idempotent.
-- =============================================================================

INSERT INTO public.app_settings (key, value) VALUES
  ('use_real_linkedin', 'off'),
  ('use_real_tiktok', 'off'),
  ('use_real_x', 'off'),
  ('use_real_youtube', 'off')
ON CONFLICT (key) DO NOTHING;
