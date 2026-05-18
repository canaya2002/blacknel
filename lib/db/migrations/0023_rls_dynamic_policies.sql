-- =============================================================================
-- 0023_rls_dynamic_policies.sql — Phase 11 / Commit 42c
--
-- # Goal
--
-- Add RESTRICTIVE RLS policies that gate the four critical operations the
-- Phase 11 cutover plan flagged for permission-based authorization, while
-- preserving the current PERMISSIVE tenant policies. Postgres AND-combines
-- RESTRICTIVE with PERMISSIVE — so the effective check becomes
--
--   (tenant matches)            -- existing PERMISSIVE policy
--   AND
--   (flag OFF OR permission OK) -- this commit's RESTRICTIVE policy
--
-- # The flag — `blacknel.rls_dynamic`
--
-- A new Postgres setting controls whether the permission checks fire.
-- Default value (NULL → coerced to 'off') means the RESTRICTIVE policies
-- short-circuit and behave as no-ops; behaviour is identical to pre-C42c.
-- Flip via:
--
--   ALTER DATABASE postgres SET blacknel.rls_dynamic = 'on';   -- enable
--   ALTER DATABASE postgres SET blacknel.rls_dynamic = 'off';  -- rollback
--
-- The `pnpm db:rls on/off` script wraps this. Documented end-to-end in
-- `doc/runbooks/rls-rollback.md`.
--
-- # Why RESTRICTIVE (not DROP/CREATE)
--
-- Postgres lacks `ALTER POLICY ENABLE/DISABLE`. The three viable patterns
-- for a "flip-on/flip-off" RLS feature are:
--
--   1. DROP existing + CREATE new          → rollback requires a reverse
--                                            migration + redeploy.
--   2. ALTER POLICY rewrites in-place      → same rollback latency.
--   3. RESTRICTIVE policy + SQL setting    → rollback is a single SQL
--                                            statement, sub-second, no
--                                            redeploy. <<<<< CHOSEN
--
-- # Why the permission helper queries the DB (not session vars)
--
-- C42b's `runAs()` sets `app.current_user_role` + `app.current_custom_role_id`
-- on every transaction, but `app_user_has_permission()` deliberately
-- delegates to `app_permission_check()` (C36a) which queries
-- `organization_members` directly. Two reasons:
--
--   (a) Don't trust client-set session vars for security decisions. The
--       DB is canonical; session vars are advisory (debugging only — see
--       `app_session_vars()` from migration 0022).
--   (b) `app_permission_check` already implements the revoke-wins custom-
--       role resolution, validated by `tests/unit/custom-roles-resolution.test.ts`.
--       Reusing it keeps a single source of truth.
--
-- `app_user_has_permission` is STABLE so Postgres caches the result within
-- a query — a SELECT against `audit_events` returning 1000 rows triggers
-- ONE permission lookup, not 1000.
--
-- # Subscriptions UPDATE — explicitly skipped (D-42c-13 emergent)
--
-- `subscriptions` only has `GRANT SELECT TO authenticated` (see
-- `0002_rls.sql` lines around subscriptions). INSERT/UPDATE go through
-- `dbAdmin` (`service_role`, BYPASSRLS). A RESTRICTIVE UPDATE policy
-- here would be a no-op today and misleading documentation, so it's
-- deferred. If C50 ever grants UPDATE to authenticated, add the gate
-- in that commit.
--
-- # The six policies installed by this migration
--
--   posts_dynamic_update_restrictive       → posts:publish
--   posts_dynamic_delete_restrictive       → posts:delete
--   audit_events_dynamic_select_restrictive → audit:read
--   custom_roles_dynamic_insert_restrictive → team:manage_roles
--   custom_roles_dynamic_update_restrictive → team:manage_roles
--   custom_roles_dynamic_delete_restrictive → team:manage_roles
--
-- custom_roles SELECT stays tenant-only by design (D-42c-4): any org
-- member can see what custom roles exist. Mutations are the gate.
--
-- # Idempotency
--
-- `CREATE OR REPLACE FUNCTION` is idempotent. Policies use
-- `DROP POLICY IF EXISTS` before `CREATE POLICY` so re-running the
-- migration under `pnpm db:reset` is safe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper 1 — read the dynamic-policies flag.
--
-- Reads `current_setting('blacknel.rls_dynamic', true)`. The `true` arg
-- makes the function return NULL (instead of erroring) when the setting
-- is undefined — which is the default state. We COALESCE NULL → 'off',
-- so a missing setting means policies are no-ops.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.app_rls_dynamic_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('blacknel.rls_dynamic', true), 'off') = 'on'
$$;

GRANT EXECUTE ON FUNCTION public.app_rls_dynamic_enabled() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper 2 — does the current session's user hold `perm` in the current org?
--
-- Reads `app.current_user_id` + `app.current_org_id` (set by `runAs()` in
-- `lib/db/client.ts`). Delegates to `app_permission_check` for the actual
-- resolution — including custom_roles revoke-wins. Fail-closed: missing
-- session context → false.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.app_user_has_permission(perm text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  _user_id uuid;
  _org_id  uuid;
BEGIN
  _user_id := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  _org_id  := NULLIF(current_setting('app.current_org_id', true), '')::uuid;
  IF _user_id IS NULL OR _org_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN app_permission_check(_user_id, _org_id, perm);
END
$$;

GRANT EXECUTE ON FUNCTION public.app_user_has_permission(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- posts — UPDATE / DELETE policies
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS posts_dynamic_update_restrictive ON posts;
CREATE POLICY posts_dynamic_update_restrictive ON posts
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (
    NOT public.app_rls_dynamic_enabled()
    OR public.app_user_has_permission('posts:publish')
  )
  WITH CHECK (
    NOT public.app_rls_dynamic_enabled()
    OR public.app_user_has_permission('posts:publish')
  );

DROP POLICY IF EXISTS posts_dynamic_delete_restrictive ON posts;
CREATE POLICY posts_dynamic_delete_restrictive ON posts
  AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (
    NOT public.app_rls_dynamic_enabled()
    OR public.app_user_has_permission('posts:delete')
  );

-- ---------------------------------------------------------------------------
-- audit_events — SELECT policy
--
-- INSERT stays open (system writes audit rows on every action, callers
-- shouldn't need a permission for that — the action they JUST did was
-- already gated by its own check). SELECT is the gate for the /audit
-- viewer and the audit_advanced export action.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS audit_events_dynamic_select_restrictive ON audit_events;
CREATE POLICY audit_events_dynamic_select_restrictive ON audit_events
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    NOT public.app_rls_dynamic_enabled()
    OR public.app_user_has_permission('audit:read')
  );

-- ---------------------------------------------------------------------------
-- custom_roles — INSERT / UPDATE / DELETE policies
--
-- SELECT stays tenant-only — Phase 10 design lets any org member see
-- what custom roles exist (UI surface). Mutations require team:manage_roles.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS custom_roles_dynamic_insert_restrictive ON custom_roles;
CREATE POLICY custom_roles_dynamic_insert_restrictive ON custom_roles
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT public.app_rls_dynamic_enabled()
    OR public.app_user_has_permission('team:manage_roles')
  );

DROP POLICY IF EXISTS custom_roles_dynamic_update_restrictive ON custom_roles;
CREATE POLICY custom_roles_dynamic_update_restrictive ON custom_roles
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (
    NOT public.app_rls_dynamic_enabled()
    OR public.app_user_has_permission('team:manage_roles')
  )
  WITH CHECK (
    NOT public.app_rls_dynamic_enabled()
    OR public.app_user_has_permission('team:manage_roles')
  );

DROP POLICY IF EXISTS custom_roles_dynamic_delete_restrictive ON custom_roles;
CREATE POLICY custom_roles_dynamic_delete_restrictive ON custom_roles
  AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (
    NOT public.app_rls_dynamic_enabled()
    OR public.app_user_has_permission('team:manage_roles')
  );

-- ---------------------------------------------------------------------------
-- Function comments — operator-facing documentation reachable via \df+
-- ---------------------------------------------------------------------------

COMMENT ON FUNCTION public.app_rls_dynamic_enabled() IS
  'Phase 11 / Commit 42c — flip read for the dynamic-RLS feature. Returns
   true iff the `blacknel.rls_dynamic` Postgres setting is exactly the
   string "on". Default (setting unset) → false → policies behave as no-ops.
   Operator flip via `pnpm db:rls on/off`.';

COMMENT ON FUNCTION public.app_user_has_permission(text) IS
  'Phase 11 / Commit 42c — RLS-friendly wrapper around app_permission_check.
   Reads user_id + org_id from the per-transaction session settings
   (app.current_user_id / app.current_org_id, set by lib/db/client.ts:runAs)
   and delegates to app_permission_check for the actual role + custom_role
   resolution. Fail-closed: missing session context returns false. STABLE so
   Postgres caches the result within a query — RLS evaluation across many
   rows triggers one permission lookup, not one per row.';
