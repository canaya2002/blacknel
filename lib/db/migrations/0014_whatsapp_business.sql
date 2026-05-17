-- ---------------------------------------------------------------------------
-- 0014_whatsapp_business.sql — Phase 9 / Commit 31
--
-- WhatsApp Business connector for Growth-tier plans. The
-- inbox-unified pattern (D-31-3-A) means we re-use
-- `connected_accounts` + `inbox_threads` + `inbox_messages` from
-- Phase 3/4 instead of building a parallel /inbox/whatsapp
-- surface. Only WhatsApp-specific concepts get new tables:
--
--   * `whatsapp_accounts` — Meta-side config (WABA id, phone
--     number id, phone display). One row per (org, phone_number).
--     References `connected_accounts.id` so the existing
--     /integrations connection lifecycle still owns status
--     transitions.
--
--   * `whatsapp_templates` — pre-approved message templates with
--     full lifecycle (`pending → approved | rejected`). This is
--     the core Meta-API surface; rejected templates carry
--     `rejected_reason` for compliance auditing.
--
-- ALTER on `inbox_messages` adds `whatsapp_template_id` FK
-- nullable (charter-justified — see CHANGELOG entry for Commit
-- 31). Habilita la trazabilidad template-vs-freeform que el
-- flow WhatsApp Business de Growth tier requiere mostrar.
-- Partial index restringe el storage cost al subset de filas
-- WhatsApp (estimado 5-20%).
-- ---------------------------------------------------------------------------

-- ---- ENUMS ----------------------------------------------------------------

CREATE TYPE whatsapp_template_status AS ENUM (
  'pending',
  'approved',
  'rejected'
);

CREATE TYPE whatsapp_template_category AS ENUM (
  'utility',
  'marketing',
  'authentication'
);

-- ---- whatsapp_accounts ----------------------------------------------------

CREATE TABLE whatsapp_accounts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connected_account_id     uuid NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  phone_number             text NOT NULL,
  phone_number_id          text NOT NULL,
  business_account_id      text NOT NULL,
  display_name             text,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_accounts_org_phone_unique
    UNIQUE (organization_id, phone_number)
);

CREATE INDEX whatsapp_accounts_connected_account_idx
  ON whatsapp_accounts (connected_account_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_accounts TO authenticated;
ALTER TABLE whatsapp_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_accounts_tenant ON whatsapp_accounts
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- whatsapp_templates ---------------------------------------------------

CREATE TABLE whatsapp_templates (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  whatsapp_account_id      uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  name                     text NOT NULL,
  category                 whatsapp_template_category NOT NULL,
  language                 text NOT NULL,
  body                     text NOT NULL,
  variables                jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                   whatsapp_template_status NOT NULL DEFAULT 'pending',
  rejected_reason          text,
  submitted_at             timestamptz NOT NULL DEFAULT now(),
  approved_at              timestamptz,
  rejected_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_templates_unique
    UNIQUE (whatsapp_account_id, name, language)
);

CREATE INDEX whatsapp_templates_org_status_idx
  ON whatsapp_templates (organization_id, status, created_at DESC);
CREATE INDEX whatsapp_templates_account_status_idx
  ON whatsapp_templates (whatsapp_account_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_templates TO authenticated;
ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_templates_tenant ON whatsapp_templates
  FOR ALL TO authenticated
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- ---- ALTER inbox_messages (Phase-4 charter touch) -------------------------
-- Justificación: habilita la trazabilidad template-vs-freeform
-- exclusiva del Growth-tier WhatsApp Business flow. Column es
-- nullable, sin default, no afecta inserts ni rows históricos
-- de Phase 4. Partial index solo cubre filas con template
-- (estimado 5-20% del total).

ALTER TABLE inbox_messages
  ADD COLUMN whatsapp_template_id uuid
    REFERENCES whatsapp_templates(id) ON DELETE SET NULL;

CREATE INDEX inbox_messages_whatsapp_template_idx
  ON inbox_messages (whatsapp_template_id)
  WHERE whatsapp_template_id IS NOT NULL;
