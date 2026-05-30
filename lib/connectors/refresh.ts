import 'server-only';

import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAsOrg } from '@/lib/db/client';
import { connectedAccounts } from '@/lib/db/schema';
import { log } from '@/lib/log';

import { getOAuthProvider } from './oauth/registry';
import type { TokenExchangeResult } from './oauth/types';
import { readAccountTokens, writeAccountTokens, type ConnectionTokens } from './tokens';

/**
 * Generic connector token refresh (C48) — the framework-level cron that keeps
 * every connector's tokens fresh (closes the C47 gap where only FB/IG refreshed).
 *
 * Scans connected_accounts (admin, system-wide) for ANY platform whose
 * token_expires_at falls inside the refresh window, then refreshes each UNDER its
 * org's RLS (dbAsOrg). Dispatch: facebook/instagram → meta's fb_exchange_token;
 * the batch-2 platforms → their OAuthProvider.refreshAccessToken. A refresh
 * failure (revoked / no refresh_token) marks the connection `expired` (visible
 * for reconnect) and the cron continues — one bad token never aborts the sweep.
 * Tokens are re-encrypted via the existing crypto; never logged.
 */

const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // refresh when <7d to expiry
const REFRESH_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'tiktok', 'x', 'youtube'] as const;

/** Refresh dispatch for one connection's tokens, by platform. */
export async function refreshForPlatform(
  platform: string,
  tokens: ConnectionTokens,
): Promise<TokenExchangeResult> {
  if (platform === 'facebook' || platform === 'instagram') {
    const { refreshMetaToken } = await import('./meta/refresh');
    return refreshMetaToken(tokens);
  }
  const provider = getOAuthProvider(platform);
  if (!provider) throw new Error(`No OAuth provider for platform ${platform}.`);
  return provider.refreshAccessToken(tokens);
}

export interface ConnectionRefreshDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  refreshFor: (platform: string, tokens: ConnectionTokens) => Promise<TokenExchangeResult>;
  now: () => Date;
}

function defaultDeps(): ConnectionRefreshDeps {
  return {
    asAdmin: (fn) => dbAdmin(fn),
    orgTx: (orgId, fn) => dbAsOrg(orgId, fn),
    refreshFor: refreshForPlatform,
    now: () => new Date(),
  };
}

export async function runConnectionTokenRefresh(
  deps: ConnectionRefreshDeps = defaultDeps(),
): Promise<{ refreshed: number; failed: number; expired: number }> {
  const threshold = new Date(deps.now().getTime() + REFRESH_WINDOW_MS);
  const due = await deps.asAdmin<Array<{ id: string; organizationId: string; platform: string }>>(
    (tx) =>
      tx
        .select({
          id: connectedAccounts.id,
          organizationId: connectedAccounts.organizationId,
          platform: connectedAccounts.platform,
        })
        .from(connectedAccounts)
        .where(
          and(
            inArray(connectedAccounts.platform, [...REFRESH_PLATFORMS]),
            eq(connectedAccounts.status, 'connected'),
            isNotNull(connectedAccounts.tokenExpiresAt),
            lt(connectedAccounts.tokenExpiresAt, threshold),
          ),
        ),
  );

  let refreshed = 0;
  let failed = 0;
  let expired = 0;
  for (const acc of due) {
    try {
      await deps.orgTx(acc.organizationId, async (tx) => {
        const tokens = await readAccountTokens(tx, acc.id);
        if (!tokens) throw new Error('no tokens stored');
        const next = await deps.refreshFor(acc.platform, tokens);
        await writeAccountTokens(tx, acc.id, {
          ...tokens,
          accessToken: next.accessToken,
          refreshToken: next.refreshToken ?? tokens.refreshToken,
          expiresAt: next.expiresAt,
        });
      });
      refreshed += 1;
    } catch (err) {
      // Revoked / unrefreshable → mark expired so the operator reconnects. Admin
      // update by id (system action); never abort the sweep on one failure.
      failed += 1;
      expired += 1;
      await deps
        .asAdmin((tx) =>
          tx
            .update(connectedAccounts)
            .set({
              status: 'expired',
              // Generic, operator-facing reason — the platform's raw error (which
              // can carry ids/tokens) goes to the log, never the DB column.
              errorMessage: 'Token refresh failed — reconnect required.',
              updatedAt: new Date(),
            })
            .where(eq(connectedAccounts.id, acc.id)),
        )
        .catch(() => undefined);
      log.error(
        { accountId: acc.id, platform: acc.platform, err: (err as Error).message },
        'connector.token_refresh.failed',
      );
    }
  }
  log.info({ refreshed, failed, expired }, 'connector.token_refresh');
  return { refreshed, failed, expired };
}
