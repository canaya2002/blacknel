-- =============================================================================
-- 0032_email_log.sql — Phase 11 / C44. WRITE ONLY (Carlos applies).
--
-- Transactional email audit log. organization_id NULL = system email (not
-- tenant-scoped). Tenant rows readable by that org via RLS; system rows
-- (null org) match no tenant policy → only service_role sees them. Writes go
-- through service_role (the email client / Inngest function). NO body stored.
-- =============================================================================

CREATE TABLE email_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  "to"            text NOT NULL,
  template        text NOT NULL,
  locale          text NOT NULL DEFAULT 'en',
  status          text NOT NULL DEFAULT 'queued',
  resend_id       text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_log_status_check CHECK (status IN ('queued', 'sent', 'failed'))
);

CREATE INDEX email_log_org_created_idx ON email_log (organization_id, created_at DESC);

-- authenticated may READ its own org's rows; writes are service_role only.
GRANT SELECT ON email_log TO authenticated;
GRANT SELECT, INSERT, UPDATE ON email_log TO service_role;
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_log_tenant_read ON email_log
  FOR SELECT TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

COMMENT ON TABLE email_log IS
  'Phase 11 / C44 — transactional email audit. Tenant-readable (RLS); system
   (null-org) rows are service_role-only. Recipient stored, body never.';
