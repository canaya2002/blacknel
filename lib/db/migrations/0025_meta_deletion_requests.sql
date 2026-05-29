-- =============================================================================
-- 0025_meta_deletion_requests.sql — Phase 11 / Meta data-deletion endpoint
--
-- Meta App Review requires a callback URL that accepts `signed_request`
-- POSTs and returns `{ url, confirmation_code }`. The full deletion (purge
-- the user's data across our tables) runs asynchronously — the POST handler
-- only ACKs and persists the request here for the deletion job to pick up.
--
-- Per-Meta-spec response shape:
--   { url: "https://blacknel.com/es/privacy#data-deletion-status",
--     confirmation_code: "<uuid>" }
--
-- # Why no RLS
--
-- This is a system table, not multi-tenant. The user_id from Meta is
-- their Facebook/Instagram external user identifier — not our internal
-- public.users.id. We never expose this table to authenticated end-users.
-- service_role writes from the route handler; the future deletion cron
-- reads from it.
-- =============================================================================

CREATE TYPE meta_deletion_status AS ENUM ('pending', 'processed', 'failed');

CREATE TABLE meta_deletion_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Meta's external user identifier (PSID or similar — not our user UUID).
  meta_user_id       text NOT NULL,
  -- Raw `signed_request` body for audit + late-stage debugging. Compact
  -- enough that we can keep it indefinitely. Contains issued_at + algorithm.
  signed_request     text NOT NULL,
  -- Uuid we hand back in the response — Meta UI shows this to the user
  -- as a tracking number on the status page.
  confirmation_code  uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  status             meta_deletion_status NOT NULL DEFAULT 'pending',
  failure_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz
);

CREATE INDEX meta_deletion_requests_status_idx
  ON meta_deletion_requests (status, created_at);

CREATE INDEX meta_deletion_requests_user_idx
  ON meta_deletion_requests (meta_user_id);

GRANT SELECT, INSERT, UPDATE ON meta_deletion_requests TO service_role;

COMMENT ON TABLE meta_deletion_requests IS
  'Phase 11 — incoming POSTs to /api/meta/data-deletion. service_role only.
   Read by the future deletion cron (TBD in C50 closure pass) to actually
   purge the corresponding user data across tenants. The route handler
   inserts; the cron updates status + processed_at.';
