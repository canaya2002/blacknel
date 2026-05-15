-- =============================================================================
-- 0004_connectors.sql — connected_accounts + connector_sync_runs.
-- =============================================================================
-- Phase 3 adds two tables and their enums. RLS keeps both org-scoped;
-- service_role inherits the existing schema-level grants from 0002.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE connected_account_status AS ENUM ('connected', 'disconnected', 'expired', 'error');
CREATE TYPE connector_sync_run_status AS ENUM ('running', 'success', 'partial', 'failed');

-- ---------------------------------------------------------------------------
-- connected_accounts
-- ---------------------------------------------------------------------------

CREATE TABLE connected_accounts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  brand_id                uuid REFERENCES brands(id) ON DELETE SET NULL,
  location_id             uuid REFERENCES locations(id) ON DELETE SET NULL,
  platform                text NOT NULL,
  external_account_id     text,
  display_name            text,
  handle                  text,
  status                  connected_account_status NOT NULL DEFAULT 'connected',
  last_sync_at            timestamptz,
  error_message           text,
  capabilities            jsonb NOT NULL DEFAULT '[]'::jsonb,
  oauth_tokens_encrypted  jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX connected_accounts_org_platform_external_unique
  ON connected_accounts (organization_id, platform, external_account_id);
CREATE INDEX connected_accounts_org_status_idx
  ON connected_accounts (organization_id, status);
CREATE INDEX connected_accounts_brand_idx
  ON connected_accounts (brand_id);

-- ---------------------------------------------------------------------------
-- connector_sync_runs
-- ---------------------------------------------------------------------------

CREATE TABLE connector_sync_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_account_id  uuid NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  status                connector_sync_run_status NOT NULL DEFAULT 'running',
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  items_synced          integer NOT NULL DEFAULT 0,
  error_message         text
);

CREATE INDEX connector_sync_runs_account_started_idx
  ON connector_sync_runs (connected_account_id, started_at);

-- ---------------------------------------------------------------------------
-- updated_at trigger for connected_accounts
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_connected_accounts_touch_updated_at
  BEFORE UPDATE ON connected_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — same pattern as 0002: authenticated may CRUD their tenant rows;
-- service_role bypasses RLS via the attribute on the role itself.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON connected_accounts TO authenticated;
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY connected_accounts_tenant ON connected_accounts
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON connector_sync_runs TO authenticated;
ALTER TABLE connector_sync_runs ENABLE ROW LEVEL SECURITY;

-- Sync runs inherit tenancy from their connected_account via a subquery.
-- Direct equality on organization_id would be cheaper but requires
-- denormalising — for Phase 3 the join is fine.
CREATE POLICY connector_sync_runs_tenant ON connector_sync_runs
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM connected_accounts ca
      WHERE ca.id = connector_sync_runs.connected_account_id
        AND ca.organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM connected_accounts ca
      WHERE ca.id = connector_sync_runs.connected_account_id
        AND ca.organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
    )
  );
