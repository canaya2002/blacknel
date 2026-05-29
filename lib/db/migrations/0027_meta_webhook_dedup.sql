-- =============================================================================
-- 0027_meta_webhook_dedup.sql — Phase 11 / C42d
--
-- Replay protection for the Meta webhook receiver (/api/webhooks/meta).
--
-- meta_webhook_events (0026) had no de-duplication: a replayed request or a
-- Meta delivery-retry inserted a duplicate row, which the C45 processor could
-- double-process (double inbound DM, double comment, etc.).
--
-- The `signature` column holds HMAC-SHA256(app_secret, raw_body). Identical
-- bodies — i.e. replays and Meta retries — produce an identical signature, so
-- a UNIQUE index on it is a natural idempotency key: the route handler inserts
-- ON CONFLICT DO NOTHING and treats a conflict as "already received, skip".
--
-- The table is EMPTY in production (Meta is not live yet), so the unique index
-- builds clean. `IF NOT EXISTS` keeps the migration idempotent under pglite
-- re-boot / db:reset.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS meta_webhook_events_signature_unique
  ON meta_webhook_events (signature);

COMMENT ON INDEX meta_webhook_events_signature_unique IS
  'Phase 11 / C42d — idempotency key for /api/webhooks/meta. signature =
   HMAC-SHA256 of the raw body; a replay/retry collides here and the route
   inserts ON CONFLICT DO NOTHING.';
