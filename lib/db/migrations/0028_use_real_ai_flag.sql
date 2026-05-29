-- =============================================================================
-- 0028_use_real_ai_flag.sql — Phase 11 / C43a. WRITE ONLY (Carlos applies).
--
-- Seed the real-AI cutover flag in app_settings (default OFF). The
-- app_settings table + GRANTs (authenticated SELECT, service_role SELECT+UPDATE)
-- already exist from migration 0024, so this only inserts the row.
--
-- The flag is the OPERATOR half of the real-AI gate (lib/ai/runtime-flag.ts +
-- lib/ai/client.ts): the real Anthropic adapter serves only when
-- use_real_ai='on' AND env.BLACKNEL_USE_REAL_AI=true AND ANTHROPIC_API_KEY is
-- set. Flip with `pnpm db:ai on/off` for <1s rollback to the mock, no redeploy.
--
-- Idempotent: ON CONFLICT DO NOTHING, safe under pglite re-boot / db:reset.
-- =============================================================================

INSERT INTO public.app_settings (key, value)
VALUES ('use_real_ai', 'off')
ON CONFLICT (key) DO NOTHING;
