-- ---------------------------------------------------------------------------
-- 0013_ads_alerts.sql — Phase 8 / Commit 29
--
-- Dedicated ads-alert table. We do NOT extend the Phase-7
-- `ai_rec_category` enum to add 'ads_alert' — that would be a
-- modification to a Phase 1-7 schema artifact and the Phase-8
-- charter rule prohibits it. A standalone table keeps Phase 8
-- self-contained.
--
-- Three enums, all NEW:
--
--   * ads_alert_kind     — what triggered: ctr drop, spend spike,
--                          account error, or a reserved slot for
--                          Fase 9 budget anomaly.
--   * ads_alert_severity — low | medium | high | critical
--   * ads_alert_status   — pending | accepted | dismissed (same
--                          lifecycle as ai_recommendations, but
--                          carved per-domain so updates can't
--                          cross-table-race).
--
-- The producer (`lib/jobs/ads-alerts-scan.ts`) merges within a
-- 48h window per Ajuste 2 — shorter than the 7d crisis window
-- because ad performance is more volatile day-to-day.
--
-- RLS: same `app.current_org_id` pattern as the rest.
-- Additive only — no ALTER on Phase 1-7 tables.
-- ---------------------------------------------------------------------------

-- ---- ENUMS ----------------------------------------------------------------

CREATE TYPE ads_alert_kind AS ENUM (
  'ctr_drop',
  'spend_spike',
  'account_error',
  'budget_anomaly_reserved'
);

CREATE TYPE ads_alert_severity AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

CREATE TYPE ads_alert_status AS ENUM (
  'pending',
  'accepted',
  'dismissed'
);

-- ---- ads_alerts -----------------------------------------------------------

CREATE TABLE ads_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ads_account_id   uuid NOT NULL REFERENCES ads_accounts(id) ON DELETE CASCADE,
  brand_id         uuid REFERENCES brands(id) ON DELETE SET NULL,
  kind             ads_alert_kind NOT NULL,
  severity         ads_alert_severity NOT NULL,
  title            text NOT NULL,
  body             text NOT NULL,
  evidence         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           ads_alert_status NOT NULL DEFAULT 'pending',
  decided_at       timestamptz,
  decided_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Banner: hot path that lists pending alerts ordered by recency.
CREATE INDEX ads_alerts_org_status_created_idx
  ON ads_alerts (organization_id, status, created_at DESC);

-- Per-account history view (Phase 9 drill-down).
CREATE INDEX ads_alerts_account_kind_status_idx
  ON ads_alerts (ads_account_id, kind, status);

-- Merge logic predicate: find an existing pending alert for
-- (org, account, kind). Partial index keeps it tiny — accepted /
-- dismissed rows are out.
CREATE INDEX ads_alerts_pending_merge_idx
  ON ads_alerts (organization_id, ads_account_id, kind)
  WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE, DELETE ON ads_alerts TO authenticated;
ALTER TABLE ads_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ads_alerts_tenant ON ads_alerts
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
