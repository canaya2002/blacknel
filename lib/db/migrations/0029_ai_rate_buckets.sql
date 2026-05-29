-- =============================================================================
-- 0029_ai_rate_buckets.sql — Phase 11 / C43b. WRITE ONLY (Carlos applies).
--
-- Persisted per-org token bucket for AI rate limiting. Survives Vercel cold
-- starts (no in-memory state). Refilled continuously by elapsed time in
-- lib/ai/rate-limit.ts; one row per org. System table — written only via the
-- adapter's dbAdmin (service_role) path, never read by end-users → no RLS
-- (same posture as meta_webhook_events / app_settings system tables).
-- =============================================================================

CREATE TABLE ai_rate_buckets (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- Fractional tokens (sub-token continuous refill).
  tokens          double precision NOT NULL,
  -- App-set epoch ms of the last refill/consume (clock lives in the app, not
  -- the DB, so refill math is consistent regardless of DB clock).
  updated_at_ms   bigint NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_rate_buckets TO service_role;

COMMENT ON TABLE ai_rate_buckets IS
  'Phase 11 / C43b — persisted per-org token bucket for AI rate limiting.
   Refilled by elapsed time in lib/ai/rate-limit.ts. service_role only.';
