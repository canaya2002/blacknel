-- =============================================================================
-- 0024_app_settings.sql — Phase 11 / C42c-hotfix
--
-- Replace the `blacknel.rls_dynamic` custom GUC with a regular table.
-- Supabase managed projects restrict `ALTER DATABASE … SET <prefix>.<name>`
-- to true superusers via the `supautils` extension; the `postgres` role
-- on hosted Supabase is NOT a true superuser, so the original C42c
-- mechanism throws `42501 permission denied to set parameter`.
--
-- This migration replaces the flag plumbing with an `app_settings` table:
--
--   - `service_role` can UPDATE the row (operator path via `pnpm db:rls`).
--   - `authenticated` can SELECT it (policy evaluation path).
--   - The replacement helper function reads from the table; the 6
--     RESTRICTIVE policies installed in 0023 are unchanged — they call
--     `app_rls_dynamic_enabled()` by name and pick up the new body
--     automatically.
--
-- Rollback latency is preserved: a single UPDATE statement flips the
-- effective state immediately for every new query (no session cycling
-- needed because `current_setting`-style caching does not apply — the
-- table read is recomputed per query under STABLE semantics).
--
-- # Why no RLS on app_settings
--
-- This is a system singleton with one row (`rls_dynamic`). It is NOT
-- per-tenant. Plain GRANTs give us the access control we need:
--
--   authenticated → SELECT only
--   service_role  → SELECT + UPDATE
--
-- Adding an RLS policy that filters by tenant would be wrong here —
-- the flag IS global by design (operator-controlled rollback for the
-- whole platform, not per-org).
--
-- # Idempotency
--
-- `CREATE TABLE IF NOT EXISTS` + `INSERT … ON CONFLICT DO NOTHING` +
-- `CREATE OR REPLACE FUNCTION` are all idempotent. Re-running under
-- `pnpm db:reset` is safe.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_settings IS
  'Phase 11 / C42c-hotfix — system singleton for operator-flippable
   feature flags that need persistent state. Currently holds:
     rls_dynamic ∈ {on, off} — C42c RLS RESTRICTIVE policy gate.
   service_role writes; authenticated reads. NO RLS — global by design.';

INSERT INTO public.app_settings (key, value)
VALUES ('rls_dynamic', 'off')
ON CONFLICT (key) DO NOTHING;

GRANT SELECT ON public.app_settings TO authenticated;
GRANT SELECT, UPDATE ON public.app_settings TO service_role;

-- ---------------------------------------------------------------------------
-- Replace the C42c helper to read from the table.
--
-- Before (0023):  COALESCE(current_setting('blacknel.rls_dynamic', true), 'off') = 'on'
-- After  (0024):  COALESCE((SELECT value FROM app_settings WHERE key = 'rls_dynamic'), 'off') = 'on'
--
-- STABLE so Postgres can cache within a query plan; SECURITY INVOKER (default)
-- so callers need the authenticated GRANT on `app_settings` to read it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.app_rls_dynamic_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.app_settings WHERE key = 'rls_dynamic'),
    'off'
  ) = 'on'
$$;

GRANT EXECUTE ON FUNCTION public.app_rls_dynamic_enabled() TO authenticated, service_role;

COMMENT ON FUNCTION public.app_rls_dynamic_enabled() IS
  'Phase 11 / C42c (hotfixed in 0024) — flip read for the dynamic-RLS
   feature. Reads from public.app_settings (key=''rls_dynamic''). Default
   value of the seeded row is ''off'', so RESTRICTIVE policies installed
   by 0023 short-circuit as no-ops until an operator runs `pnpm db:rls on`.
   STABLE: cached within a query plan.';
