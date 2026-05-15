-- =============================================================================
-- 0000_setup.sql — Extensions and Postgres roles.
-- =============================================================================
-- Runs first. Establishes the roles every later migration assumes exist
-- (`authenticated`, `service_role`) and the extensions our schema relies on.
--
-- This file is idempotent: re-running it on a fresh DB (e.g. pglite test
-- fixture) does not fail. Re-running on a Supabase-provisioned DB is a
-- no-op for role creation (Supabase ships the same names).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- `gen_random_uuid()` is built-in since Postgres 13 — no extension
-- required for our default PK strategy. Supabase Cloud preloads pgcrypto
-- separately if higher-grade crypto is wanted; we don't ask for it here
-- because pglite's WASM build doesn't ship the control file.

-- ---------------------------------------------------------------------------
-- Roles used for RLS gating.
--
-- `authenticated` — what end-user requests run as. No superuser, no
--                   BYPASSRLS. dbAs() SET LOCAL ROLEs to this before
--                   any tenant-scoped query.
--
-- `service_role` — admin role. BYPASSRLS attribute means policies are
--                   skipped entirely. dbAdmin() SET LOCAL ROLEs here.
--                   Every caller is audited.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

-- Defensive: ensure BYPASSRLS is set on service_role even if it pre-existed
-- without it (e.g., a manually created role on a non-Supabase DB).
ALTER ROLE service_role WITH BYPASSRLS;

-- The connection role (`postgres` on Supabase, `postgres` on pglite) must
-- have membership in both roles so SET LOCAL ROLE works in transactions.
DO $$
DECLARE
  conn_role text := current_user;
BEGIN
  EXECUTE format('GRANT authenticated TO %I', conn_role);
  EXECUTE format('GRANT service_role TO %I', conn_role);
EXCEPTION WHEN OTHERS THEN
  -- Membership may already exist or the role may itself be a superuser
  -- where GRANT is redundant; both cases are fine.
  NULL;
END $$;
