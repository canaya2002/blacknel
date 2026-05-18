-- =============================================================================
-- 0022_rls_session_vars.sql — Phase 11 / Commit 42b
--
-- Extends the per-transaction session-variable surface that RLS policies
-- read from. Pre-C42b, `runAs()` set TWO vars inside every `dbAs` transaction:
--
--   app.current_org_id   — tenant filter, read by every `_tenant` policy.
--   app.current_user_id  — identity filter (e.g. read-self).
--
-- C42b adds TWO more (set in `lib/db/client.ts:runAs` once this migration
-- has been applied — the SET LOCAL calls land in the same commit):
--
--   app.current_user_role       — the caller's enum role inside the org
--                                 ('owner' / 'admin' / 'manager' / 'agent' /
--                                 'viewer'). Empty string if the caller
--                                 didn't pass `role` to `dbAs`.
--   app.current_custom_role_id  — optional uuid pointer to a `custom_roles`
--                                 row that overlays the base role. Empty
--                                 string if absent.
--
-- C42b is **plumbing only**: no RLS policy in the schema currently reads
-- the two new vars. C42c (the next sub-commit in the Phase 11 / Commit 42
-- triple) lands dynamic policies on `posts`, `subscriptions`,
-- `audit_events`, and `custom_roles` that DO read these. Until that
-- commit ships, the vars are inert and the cost is two extra `set_config`
-- calls per transaction (~0.05 ms).
--
-- # No GRANTs needed for session vars
--
-- `current_setting('app.foo', true)` is available to every role without
-- a GRANT. Postgres treats `app.*` settings as customizable user-defined
-- variables; access is per-session, not per-object. The `app_session_vars()`
-- helper below DOES need an EXECUTE grant — that's a regular function.
--
-- # Idempotency
--
-- `CREATE OR REPLACE FUNCTION` is idempotent. The migration runner only
-- applies this file once (tracked by sha256) but re-running it under
-- `pnpm db:reset` is also safe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- app_session_vars() — debugging + testing surface.
--
-- Returns the four `app.current_*` session settings as jsonb. Used by:
--
--   * `tests/integration/db-client-session-vars.test.ts` — verifies that
--     `runAs()` set all four vars correctly.
--   * `tests/integration/rls.live.test.ts` (Phase 11 / C42c) — verifies
--     dynamic policies see the role/custom_role_id values.
--   * Operator debugging — paste into Supabase SQL editor inside a
--     transaction that has just called `runAs` to see live session state.
--
-- Returns empty strings (not NULL) for unset vars — `current_setting(..., true)`
-- returns NULL when missing, the COALESCE normalises that for clean jsonb
-- output.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.app_session_vars()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'org_id',         COALESCE(current_setting('app.current_org_id', true), ''),
    'user_id',        COALESCE(current_setting('app.current_user_id', true), ''),
    'user_role',      COALESCE(current_setting('app.current_user_role', true), ''),
    'custom_role_id', COALESCE(current_setting('app.current_custom_role_id', true), '')
  )
$$;

GRANT EXECUTE ON FUNCTION public.app_session_vars() TO authenticated, service_role;
