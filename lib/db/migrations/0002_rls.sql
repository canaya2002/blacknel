-- =============================================================================
-- 0002_rls.sql — Row Level Security policies and grants.
-- =============================================================================
-- All tenant-scoped tables get RLS enabled here. Two roles matter:
--
--   - `authenticated` (NO BYPASSRLS) — used by `dbAs()`. Policies decide
--      what they can see based on the session-local config values:
--        * `app.current_org_id`
--        * `app.current_user_id`
--      A query made by dbAs() without these set returns ZERO rows
--      (current_setting('...', true) returns NULL → NULL = uuid is NULL
--      → policy USING-clause is falsy). Fail-closed.
--
--   - `service_role` (BYPASSRLS attribute) — used by `dbAdmin()`. RLS is
--     entirely skipped at the role level, so no policy applies. Granted
--     ALL privileges below for completeness.
--
-- If you add a new tenant-scoped table in a later migration, ENABLE RLS
-- on it and add a policy here (or in that migration). Defaulting to RLS
-- off is the single most common way tenant isolation gets broken.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- service_role: full access (bypasses RLS by attribute, but we still need
-- INSERT/SELECT/UPDATE/DELETE GRANTs at the SQL-grant layer).
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

-- ---------------------------------------------------------------------------
-- authenticated: schema usage. Per-table GRANTs follow.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO authenticated;

-- ---------------------------------------------------------------------------
-- plans — global, read-only for authenticated.
-- ---------------------------------------------------------------------------

GRANT SELECT ON plans TO authenticated;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_read_all ON plans
  FOR SELECT TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- users — see self or anyone in your current org. Update self only.
-- ---------------------------------------------------------------------------

GRANT SELECT, UPDATE ON users TO authenticated;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_self_or_org_member ON users
  FOR SELECT TO authenticated
  USING (
    id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR id IN (
      SELECT om.user_id
      FROM organization_members om
      WHERE om.organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        AND om.status = 'active'
    )
  );

CREATE POLICY users_update_self ON users
  FOR UPDATE TO authenticated
  USING (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- organizations — see only your current org. Update only your current org.
-- ---------------------------------------------------------------------------

GRANT SELECT, UPDATE ON organizations TO authenticated;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizations_self ON organizations
  FOR ALL TO authenticated
  USING (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- organization_members — see members of your current org.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON organization_members TO authenticated;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_members_tenant ON organization_members
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON invitations TO authenticated;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY invitations_tenant ON invitations
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- brand_voices
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON brand_voices TO authenticated;
ALTER TABLE brand_voices ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_voices_tenant ON brand_voices
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- brands
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON brands TO authenticated;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY brands_tenant ON brands
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- locations
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON locations TO authenticated;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY locations_tenant ON locations
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------

GRANT SELECT ON subscriptions TO authenticated;
-- INSERT/UPDATE go through dbAdmin (billing webhooks, plan changes from
-- the Billing UI go through Server Actions that use dbAdmin).
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_tenant_read ON subscriptions
  FOR SELECT TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- usage_counters
-- ---------------------------------------------------------------------------

GRANT SELECT ON usage_counters TO authenticated;
-- INSERT/UPDATE happen in dbAdmin contexts (jobs, plan-limit checks
-- triggered server-side).
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_counters_tenant_read ON usage_counters
  FOR SELECT TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- audit_events — tenant-scoped reads; inserts allowed scoped to caller's
-- org (audit log helpers run inside dbAs).
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON audit_events TO authenticated;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_events_tenant_read ON audit_events
  FOR SELECT TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

CREATE POLICY audit_events_tenant_insert ON audit_events
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
