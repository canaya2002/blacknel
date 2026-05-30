-- ---------------------------------------------------------------------------
-- 0039_listening_account_mentions.sql — Phase 11 / C53 (Listening pillar)
--
-- The Phase-9 listening model (listening_tracked_terms + listening_mentions) is
-- term-based: every mention matched a tracked keyword/hashtag/handle. C53 adds
-- the ACCOUNT-based path — @mentions/tags discovered ON a connected account via
-- its platform API (the "achievable" listening, vs broad web listening which
-- needs an external provider we don't have). Those mentions aren't tied to a
-- tracked term, so:
--   - tracked_term_id becomes NULLABLE (account-discovered mentions have none);
--   - connected_account_id (the task's "connection ref") records which account
--     surfaced the mention.
--
-- Plus the use_real_listening flag (OFF) gating the real platform mention APIs.
-- Write-only / additive: ADD COLUMN + DROP NOT NULL (relaxes, no data change) +
-- INSERT. No DROP of data.
-- ---------------------------------------------------------------------------

ALTER TABLE listening_mentions
  ADD COLUMN IF NOT EXISTS connected_account_id uuid REFERENCES connected_accounts(id) ON DELETE SET NULL;

ALTER TABLE listening_mentions ALTER COLUMN tracked_term_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS listening_mentions_connected_account_idx
  ON listening_mentions (connected_account_id)
  WHERE connected_account_id IS NOT NULL;

-- Real platform mention APIs (Meta tagged/tags first) OFF until creds + the
-- per-platform permissions land. Read fresh per call (fail-closed) like the
-- other use_real_* flags.
INSERT INTO public.app_settings (key, value)
VALUES ('use_real_listening', 'off')
ON CONFLICT (key) DO NOTHING;
