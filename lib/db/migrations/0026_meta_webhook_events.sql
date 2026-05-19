-- =============================================================================
-- 0026_meta_webhook_events.sql — Phase 11 / Meta webhook endpoint
--
-- Meta posts webhook events to /api/webhooks/meta for every subscribed
-- product (Facebook pages, Instagram, WhatsApp Business, Messenger). The
-- POST handler validates the HMAC-SHA256 signature on the raw body and
-- persists the event here, then returns 200 inside Meta's <5s response
-- budget. The actual processor (TBD C45) reads `pending` rows, resolves
-- each event to a tenant via `connected_accounts`, and fans out to the
-- inbox / review pipelines.
--
-- # Why no RLS
--
-- System table. Events arrive with no authenticated session — tenancy is
-- determined post-hoc by C45 by joining the payload's external IDs against
-- `connected_accounts.external_account_id`. Until C45 lands, we never
-- expose this table to end-users; service_role writes from the route
-- handler, service_role reads from the processor.
-- =============================================================================

CREATE TYPE meta_webhook_event_status AS ENUM ('pending', 'processed', 'failed');

CREATE TABLE meta_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Top-level `object` field Meta sends: 'page', 'instagram',
  -- 'whatsapp_business_account', etc. Used by C45 to dispatch to the
  -- right per-product handler. 'unknown' when the body lacks an object
  -- field (defensive — should never happen in production traffic).
  event_object    text NOT NULL,
  -- Full webhook body, retained verbatim for replay + debugging.
  event_payload   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Raw `sha256=...` header value, kept for forensic re-validation.
  signature       text NOT NULL,
  status          meta_webhook_event_status NOT NULL DEFAULT 'pending',
  failure_reason  text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

CREATE INDEX meta_webhook_events_status_idx
  ON meta_webhook_events (status, received_at);

CREATE INDEX meta_webhook_events_object_idx
  ON meta_webhook_events (event_object);

GRANT SELECT, INSERT, UPDATE ON meta_webhook_events TO service_role;

COMMENT ON TABLE meta_webhook_events IS
  'Phase 11 — incoming Meta webhook POSTs (Facebook/Instagram/WhatsApp/Messenger).
   Inserted by /api/webhooks/meta after HMAC-SHA256 validation. Read by the
   C45 event processor for org-scoped fan-out. service_role only.';
