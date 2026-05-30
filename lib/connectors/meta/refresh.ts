import 'server-only';

import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAsOrg } from '@/lib/db/client';
import { connectedAccounts } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

import { readAccountTokens, writeAccountTokens, type ConnectionTokens } from '../tokens';

import { useRealMeta } from './config';
import { graphRequest } from './graph';

/**
 * Refresh soon-to-expire Meta connection tokens (C46). Long-lived Page tokens
 * last ~60 days; this cron re-derives them before they lapse. Scans
 * connected_accounts by the plaintext token_expires_at mirror (admin, system-
 * wide), then refreshes each UNDER its own org RLS (dbAsOrg). Real path calls
 * Graph's fb_exchange_token; mock path extends the expiry (no network).
 */

const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // refresh when <7d to expiry
const MOCK_EXTENSION_MS = 60 * 24 * 60 * 60 * 1000; // mock: +60d

export interface RefreshDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  refreshToken: (tokens: ConnectionTokens) => Promise<{ accessToken: string; expiresAt: string | null }>;
  now: () => Date;
}

async function defaultRefreshToken(
  tokens: ConnectionTokens,
): Promise<{ accessToken: string; expiresAt: string | null }> {
  if (!(await useRealMeta())) {
    return { accessToken: tokens.accessToken, expiresAt: new Date(Date.now() + MOCK_EXTENSION_MS).toISOString() };
  }
  const long = await graphRequest<{ access_token: string; expires_in?: number }>({
    method: 'GET',
    path: '/oauth/access_token',
    params: {
      grant_type: 'fb_exchange_token',
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      fb_exchange_token: tokens.accessToken,
    },
  });
  return {
    accessToken: long.access_token,
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
  };
}

function defaultDeps(): RefreshDeps {
  return {
    asAdmin: (fn) => dbAdmin(fn),
    orgTx: (orgId, fn) => dbAsOrg(orgId, fn),
    refreshToken: defaultRefreshToken,
    now: () => new Date(),
  };
}

export async function runMetaTokenRefresh(
  deps: RefreshDeps = defaultDeps(),
): Promise<{ refreshed: number; failed: number }> {
  const threshold = new Date(deps.now().getTime() + REFRESH_WINDOW_MS);
  const due = await deps.asAdmin<Array<{ id: string; organizationId: string }>>((tx) =>
    tx
      .select({ id: connectedAccounts.id, organizationId: connectedAccounts.organizationId })
      .from(connectedAccounts)
      .where(
        and(
          inArray(connectedAccounts.platform, ['facebook', 'instagram']),
          eq(connectedAccounts.status, 'connected'),
          isNotNull(connectedAccounts.tokenExpiresAt),
          lt(connectedAccounts.tokenExpiresAt, threshold),
        ),
      ),
  );

  let refreshed = 0;
  let failed = 0;
  for (const acc of due) {
    try {
      await deps.orgTx(acc.organizationId, async (tx) => {
        const tokens = await readAccountTokens(tx, acc.id);
        if (!tokens) return;
        const next = await deps.refreshToken(tokens);
        await writeAccountTokens(tx, acc.id, {
          ...tokens,
          accessToken: next.accessToken,
          expiresAt: next.expiresAt,
        });
      });
      refreshed += 1;
    } catch (err) {
      failed += 1;
      log.error({ accountId: acc.id, err: (err as Error).message }, 'meta.token_refresh.failed');
    }
  }
  log.info({ refreshed, failed }, 'meta.token_refresh');
  return { refreshed, failed };
}
