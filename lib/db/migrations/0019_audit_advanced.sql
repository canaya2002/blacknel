-- ---------------------------------------------------------------------------
-- 0019_audit_advanced.sql — Phase 10 / Commit 37
--
-- Advanced Audit (Enterprise-tier). Promotes the Phase-7 audit
-- table to SOC 2 ready capabilities:
--
--   * Per-row `event_hash` for tampering detection (D-37-2 (a) —
--     per-row hash, not chained).
--   * `audit_retention_policies` — per-org retention config with
--     overlap-aware precedence (Ajuste 2: specificity wins; on
--     tie, longer retention wins).
--   * `audit_anomalies` — heuristic detector output with
--     pending / dismissed lifecycle.
--   * Anomaly dismissal requires `decided_reason` (≥10 chars) —
--     Ajuste 1, compliance audit trail.
--
-- # Charter touch on audit_events (Phase 7)
--
-- `event_hash` column NULLABLE — old rows stay NULL (no
-- back-fill in this migration; insertion-time computation only).
-- Tampering detection only applies to NEW events. Phase 11 can
-- back-fill if needed via a one-shot script.
-- ---------------------------------------------------------------------------

-- ---- ENUMS ----------------------------------------------------------------

CREATE TYPE audit_anomaly_kind AS ENUM (
  'off_hours_access',
  'new_ip',
  'mass_export'
);

CREATE TYPE audit_anomaly_status AS ENUM (
  'pending',
  'dismissed',
  'accepted'
);

-- ---- ALTER audit_events (Phase-7 charter touch) ---------------------------

ALTER TABLE audit_events
  ADD COLUMN event_hash text;

CREATE INDEX audit_events_hash_idx
  ON audit_events (event_hash) WHERE event_hash IS NOT NULL;

-- ---- audit_retention_policies --------------------------------------------

CREATE TABLE audit_retention_policies (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- 'all' = catch-all; otherwise an action prefix like 'billing.*'
  -- or an exact action name 'billing.charge'.
  applies_to               text NOT NULL,
  retention_days           integer NOT NULL,
  created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_retention_days_positive
    CHECK (retention_days > 0),
  CONSTRAINT audit_retention_org_pattern_unique
    UNIQUE (organization_id, applies_to)
);

CREATE INDEX audit_retention_org_idx
  ON audit_retention_policies (organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON audit_retention_policies TO authenticated;
ALTER TABLE audit_retention_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_retention_tenant ON audit_retention_policies
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- audit_anomalies ------------------------------------------------------

CREATE TABLE audit_anomalies (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind                     audit_anomaly_kind NOT NULL,
  status                   audit_anomaly_status NOT NULL DEFAULT 'pending',
  user_id                  uuid REFERENCES users(id) ON DELETE SET NULL,
  evidence                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_at               timestamptz,
  decided_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_reason           text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  -- Ajuste 1 — dismiss / accept MUST carry a reason ≥10 chars.
  -- Pending rows allow NULL.
  CONSTRAINT audit_anomalies_decided_reason_when_decided
    CHECK (
      status = 'pending'
      OR (decided_reason IS NOT NULL AND length(btrim(decided_reason)) >= 10)
    )
);

CREATE INDEX audit_anomalies_org_status_idx
  ON audit_anomalies (organization_id, status, created_at DESC);
CREATE INDEX audit_anomalies_kind_idx
  ON audit_anomalies (organization_id, kind, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON audit_anomalies TO authenticated;
ALTER TABLE audit_anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_anomalies_tenant ON audit_anomalies
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
