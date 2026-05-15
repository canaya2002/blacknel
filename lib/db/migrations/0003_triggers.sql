-- =============================================================================
-- 0003_triggers.sql — updated_at maintenance + auth.users sync.
-- =============================================================================
-- Two unrelated trigger families live here:
--
--   1. `touch_updated_at()` — BEFORE UPDATE trigger that stamps every
--      tenant table's `updated_at` to NOW(). Enforced at the DB so app
--      code can never "forget" to update it.
--
--   2. `handle_new_auth_user()` — AFTER INSERT trigger on `auth.users`
--      that mirrors the row into `public.users`. Required by the
--      Supabase Auth model: GoTrue owns `auth.users`, the rest of our
--      schema joins against `public.users`. See `README.md` in this
--      directory for the full picture, failure modes, and debugging.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Generic updated_at trigger.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_organizations_touch_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_users_touch_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_organization_members_touch_updated_at
  BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_invitations_touch_updated_at
  BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_brand_voices_touch_updated_at
  BEFORE UPDATE ON brand_voices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_brands_touch_updated_at
  BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_locations_touch_updated_at
  BEFORE UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_plans_touch_updated_at
  BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_subscriptions_touch_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_usage_counters_touch_updated_at
  BEFORE UPDATE ON usage_counters
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- audit_events has no updated_at (append-only by design).

-- ---------------------------------------------------------------------------
-- 2. auth.users → public.users mirror.
-- ---------------------------------------------------------------------------
--
-- This trigger is the only thing keeping `public.users` in sync with
-- Supabase Auth. It fires AFTER each INSERT into `auth.users` (which
-- happens during sign-up, magic-link confirmation, OAuth callback, etc.)
-- and either inserts a matching row into `public.users` or — if one
-- already exists with the same id — updates the email.
--
-- SECURITY DEFINER + an explicit search_path is required so the function
-- can write to `public.users` regardless of which role triggered the
-- INSERT in `auth.users` (GoTrue runs as the `supabase_auth_admin` role,
-- which has no privileges on `public` by default).
--
-- Requires `auth.users` to exist before this migration runs. Supabase
-- provisions it as part of GoTrue setup. Tests stub it in
-- `tests/helpers/test-db.ts` before applying migrations.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, created_at, updated_at)
  VALUES (NEW.id, NEW.email, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE
    SET email      = EXCLUDED.email,
        updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Drop and recreate so re-running on Supabase (where the trigger may
-- already exist from a prior install) is a no-op.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
