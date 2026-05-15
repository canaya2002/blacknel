import 'server-only';

import { eq } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { connectedAccounts } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { syncAccount } from '@/lib/jobs/sync-account';

/**
 * Synthetic connector-event ticker. Active only when
 * `BLACKNEL_MOCK_EVENTS=true`. On /integrations visits we may advance
 * the simulation by one tick — at most once every 60s per process —
 * to keep the dev experience lively without a real cron:
 *
 *   - ~10% of `connected` accounts roll to `expired` (token rot).
 *   - ~3% roll to `error` (transient platform failure).
 *   - All remaining `connected` accounts get a fresh sync run.
 *
 * Phase 11 replaces this with Inngest cron jobs that consume real
 * webhooks + scheduled refreshes.
 */

const TICK_INTERVAL_MS = 60_000;
let _lastTickAt = 0;

export async function maybeTickConnectorEvents(): Promise<{ ticked: boolean }> {
  if (!env.BLACKNEL_MOCK_EVENTS) return { ticked: false };
  const now = Date.now();
  if (now - _lastTickAt < TICK_INTERVAL_MS) return { ticked: false };
  _lastTickAt = now;

  // Pull the small pool of accounts to consider this tick.
  const candidates = await dbAdmin<Array<{ id: string; status: 'connected' | 'disconnected' | 'expired' | 'error' }>>(async (tx) =>
    tx
      .select({
        id: connectedAccounts.id,
        status: connectedAccounts.status,
      })
      .from(connectedAccounts)
      .limit(50),
  );

  let expired = 0;
  let errored = 0;
  let synced = 0;

  for (const acc of candidates) {
    if (acc.status !== 'connected') continue;
    const roll = Math.random();
    if (roll < 0.1) {
      await dbAdmin(async (tx) =>
        tx
          .update(connectedAccounts)
          .set({
            status: 'expired',
            errorMessage: 'Mock token expired during dev tick.',
          })
          .where(eq(connectedAccounts.id, acc.id)),
      );
      expired += 1;
    } else if (roll < 0.13) {
      await dbAdmin(async (tx) =>
        tx
          .update(connectedAccounts)
          .set({
            status: 'error',
            errorMessage: 'Mock platform 5xx during dev tick.',
          })
          .where(eq(connectedAccounts.id, acc.id)),
      );
      errored += 1;
    } else {
      // Best-effort sync. syncAccount swallows its own errors.
      const result = await syncAccount(acc.id);
      if (result.kind === 'ok') synced += 1;
    }
  }

  log.info({ expired, errored, synced }, 'connector.dev-events.tick');
  return { ticked: true };
}
