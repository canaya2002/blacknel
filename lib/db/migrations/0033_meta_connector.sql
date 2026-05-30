-- =============================================================================
-- 0033_meta_connector.sql — Phase 11 / C46. WRITE ONLY (Carlos applies).
--
-- Meta (Facebook Pages + Instagram Business) connector, the first real provider
-- on the existing connectors framework. Builds on connected_accounts (tokens go
-- in the reserved oauth_tokens_encrypted jsonb) — NO new connections table.
--
--   1. token_expires_at: plaintext mirror of the encrypted token's expiry so the
--      refresh cron can find soon-to-expire connections without decrypting.
--   2. use_real_meta flag (default OFF) — gates real Graph API vs mock connector,
--      flipped with `pnpm db:flag use_real_meta on/off`.
--
-- Both idempotent. connected_accounts already has RLS (0004) + the tenant policy;
-- adding a column inherits it.
-- =============================================================================

ALTER TABLE public.connected_accounts
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;

-- Partial index for the refresh cron's "expiring soon" scan.
CREATE INDEX IF NOT EXISTS connected_accounts_token_expiry_idx
  ON public.connected_accounts (token_expires_at)
  WHERE token_expires_at IS NOT NULL;

INSERT INTO public.app_settings (key, value) VALUES
  ('use_real_meta', 'off')
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN public.connected_accounts.token_expires_at IS
  'Phase 11 / C46 — plaintext mirror of the encrypted OAuth token expiry, for
   the refresh cron to query without decrypting. Null = non-expiring / none.';
