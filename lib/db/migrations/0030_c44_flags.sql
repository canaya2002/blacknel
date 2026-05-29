-- =============================================================================
-- 0030_c44_flags.sql — Phase 11 / C44. WRITE ONLY (Carlos applies).
--
-- Seed the three C44 subsystem cutover flags (default OFF) in app_settings.
-- Each gates real-vs-mock for its subsystem (read via lib/flags.ts; flipped
-- with `pnpm db:flag <name> on/off`). The table + GRANTs exist from 0024.
-- Idempotent.
-- =============================================================================

INSERT INTO public.app_settings (key, value) VALUES
  ('use_real_storage', 'off'),
  ('use_real_email', 'off'),
  ('use_real_inngest', 'off')
ON CONFLICT (key) DO NOTHING;
