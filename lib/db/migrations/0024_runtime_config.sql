-- =============================================================================
-- 0024_runtime_config.sql — Phase 11 / Commit 42c follow-up.
--
-- # Why this migration exists
--
-- C42c (migration 0023) gated its RESTRICTIVE policies on the Postgres
-- setting `blacknel.rls_dynamic`, flipped via `ALTER DATABASE postgres SET …`.
-- That worked on pglite (CI + dev) but failed on Supabase managed:
--
--   PostgresError 42501: permission denied to set parameter "blacknel.rls_dynamic"
--
-- Root cause: Supabase's `postgres` role does not hold `rolsuper`, and custom
-- GUCs (namespace prefix `blacknel.*`) are not registered in Supabase's
-- managed `customized_options` list. Postgres core requires superuser OR a
-- pre-registered parameter to `ALTER DATABASE SET <custom>`. Probed on
-- 2026-05-19: ALTER DATABASE, ALTER ROLE authenticated, ALTER ROLE postgres
-- — all rejected with 42501.
--
-- # Replacement mechanism
--
-- One row in a `runtime_config` table. `app_rls_dynamic_enabled()` is
-- replaced (CREATE OR REPLACE) to read from the table instead of (or in
-- addition to) the GUC. Operator flip is now a plain `UPDATE` that any
-- postgres connection can issue.
--
-- # Hybrid function design
--
-- `app_rls_dynamic_enabled()` still checks `current_setting('blacknel.rls_dynamic')`
-- first. If a SESSION-LOCAL value is set (e.g. by `SET LOCAL` inside a test
-- transaction) it wins — preserves the existing CI test pattern in
-- `tests/integration/rls-dynamic.test.ts` without rewriting. Only when the
-- session setting is unset do we fall back to the table. Production uses
-- the table path (the GUC stays unset because Supabase rejects it).
--
-- # Privileges
--
-- - `authenticated` and `anon` get SELECT (the RLS policy function is
--   STABLE LANGUAGE sql and runs with caller privileges; the authenticated
--   role's SELECT on this table is what makes RLS evaluation possible).
-- - `service_role` inherits via Supabase defaults but we GRANT it explicitly
--   for clarity.
-- - INSERT / UPDATE / DELETE stay owner-only (postgres) — no GRANT issued.
--
-- # Why no RLS on the table
--
-- runtime_config is global system data, not tenant data. There is nothing
-- to scope per tenant; the row is the same for every reader. Skip RLS for
-- the same reason `role_permissions` skips tenant scoping.
-- =============================================================================

CREATE TABLE IF NOT EXISTS runtime_config (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE runtime_config IS
  'Phase 11 / Commit 42c follow-up — global runtime flags flipped at
   operator-time. Replaces custom GUCs that Supabase managed does not
   allow non-superusers to ALTER. Read by SQL helper functions; written
   by `pnpm db:rls on/off` (and any future flag operator scripts).';

GRANT SELECT ON runtime_config TO authenticated, anon, service_role;

-- Seed the rls_dynamic row in the off state (matches pre-C42c behavior).
INSERT INTO runtime_config (key, value)
VALUES ('rls_dynamic', 'off')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Replace app_rls_dynamic_enabled() with the hybrid lookup.
-- ---------------------------------------------------------------------------
--
-- Priority:
--   1. SESSION-LOCAL `blacknel.rls_dynamic` setting (tests + ad-hoc operator).
--   2. runtime_config row (production operator flip).
--   3. Default: false (no-op — same as pre-C42c).
--
-- STABLE preserves the per-query plan caching from migration 0023 so a
-- 1000-row SELECT triggers ONE lookup, not 1000.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.app_rls_dynamic_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    -- Session-local override (tests use `SET LOCAL …` per-transaction).
    NULLIF(current_setting('blacknel.rls_dynamic', true), '') = 'on',
    -- Persisted operator flip — production path.
    (SELECT value = 'on' FROM runtime_config WHERE key = 'rls_dynamic'),
    -- Fail-closed default.
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.app_rls_dynamic_enabled() TO authenticated, service_role;

COMMENT ON FUNCTION public.app_rls_dynamic_enabled() IS
  'Phase 11 / Commit 42c + 0024 follow-up — returns true iff dynamic RLS
   enforcement is ON. Reads (1) session-local `blacknel.rls_dynamic`, then
   (2) runtime_config.rls_dynamic, then defaults to false. The session-local
   path preserves `SET LOCAL blacknel.rls_dynamic = ''on''` inside tests
   without rewriting them; production flips via UPDATE on the table (the
   ALTER DATABASE pattern is blocked by Supabase managed).';
