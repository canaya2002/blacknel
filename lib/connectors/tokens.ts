import 'server-only';

import { eq } from 'drizzle-orm';

import type { AnyPgTx } from '@/lib/db/client';
import { connectedAccounts } from '@/lib/db/schema';

import {
  decryptJson,
  encryptJson,
  isEncryptedEnvelope,
  type EncryptedEnvelope,
} from './crypto';

/**
 * Read/write encrypted OAuth tokens on `connected_accounts` (C46). Tokens live
 * in the reserved `oauth_tokens_encrypted` jsonb column (AES-256-GCM envelope);
 * `token_expires_at` is mirrored to a plaintext column so the refresh cron can
 * find soon-to-expire connections WITHOUT decrypting every row.
 *
 * All functions take a `tx` so the caller controls the RLS context — write/read
 * under `dbAs(orgId)`/`dbAsOrg(orgId)` so a connection's tokens are only ever
 * touched within its own tenant.
 */

export interface ConnectionTokens {
  /** Long-lived page/IG access token used for Graph API calls. */
  readonly accessToken: string;
  /** Long-lived user token kept for re-deriving page tokens (optional). */
  readonly refreshToken?: string;
  readonly tokenType?: string;
  /** ISO-8601 expiry, or null for non-expiring page tokens. */
  readonly expiresAt?: string | null;
  readonly scopes?: ReadonlyArray<string>;
}

/** Encrypt + persist tokens for an account. Sets token_expires_at for querying. */
export async function writeAccountTokens(
  tx: AnyPgTx,
  accountId: string,
  tokens: ConnectionTokens,
): Promise<void> {
  const envelope = encryptJson(tokens);
  await tx
    .update(connectedAccounts)
    .set({
      oauthTokensEncrypted: envelope,
      tokenExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
      updatedAt: new Date(),
    })
    .where(eq(connectedAccounts.id, accountId));
}

/** Decrypt the stored tokens for an account, or null if none stored yet. */
export async function readAccountTokens(
  tx: AnyPgTx,
  accountId: string,
): Promise<ConnectionTokens | null> {
  const rows = await tx
    .select({ blob: connectedAccounts.oauthTokensEncrypted })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.id, accountId))
    .limit(1);
  const blob = (rows as Array<{ blob: unknown }>)[0]?.blob;
  if (!isEncryptedEnvelope(blob)) return null; // empty `{}` = no tokens yet.
  return decryptJson<ConnectionTokens>(blob as EncryptedEnvelope);
}
