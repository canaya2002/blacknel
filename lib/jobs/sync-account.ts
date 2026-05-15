import 'server-only';

import { and, eq } from 'drizzle-orm';

import { getConnector } from '@/lib/connectors/registry';
import type { ConnectorAccount, PlatformCode } from '@/lib/connectors/base';
import { ConnectorError } from '@/lib/connectors/base';
import { dbAdmin } from '@/lib/db/client';
import { connectedAccounts, connectorSyncRuns } from '@/lib/db/schema';
import { log } from '@/lib/log';

/**
 * In-process sync job dispatcher.
 *
 * Phase 11 cutover replaces this with an Inngest function. The
 * `syncAccount(accountId)` shape stays — callers ("Sync now" button,
 * dev events ticker, future webhooks) keep working.
 *
 * Behavior:
 *
 *   1. Look up the account row.
 *   2. Bail with NO-OP if there is already a `running` run (idempotent
 *      against accidental double-fires).
 *   3. Open a new `connector_sync_runs` row with status='running'.
 *   4. Call the platform's `connector.sync(account)`.
 *   5. Close the run with the resulting `itemsSynced` + status, and
 *      bump `connected_accounts.last_sync_at`.
 *
 * Errors from `connector.sync` are NOT thrown out — we record them on
 * the sync run + flag the account `error` / `expired` as appropriate.
 */

export interface SyncResult {
  kind: 'ok' | 'skipped' | 'failed';
  runId?: string;
  itemsSynced?: number;
  error?: string;
}

export async function syncAccount(accountId: string): Promise<SyncResult> {
  return dbAdmin<SyncResult>(async (tx) => {
    const row = (
      await tx
        .select()
        .from(connectedAccounts)
        .where(eq(connectedAccounts.id, accountId))
        .limit(1)
    )[0];
    if (!row) return { kind: 'failed', error: 'account_not_found' };

    // Idempotency guard: refuse a parallel run.
    const inFlight = (
      await tx
        .select({ id: connectorSyncRuns.id })
        .from(connectorSyncRuns)
        .where(
          and(
            eq(connectorSyncRuns.connectedAccountId, accountId),
            eq(connectorSyncRuns.status, 'running'),
          ),
        )
        .limit(1)
    )[0];
    if (inFlight) {
      return { kind: 'skipped', runId: inFlight.id };
    }

    const runInsert = (
      await tx
        .insert(connectorSyncRuns)
        .values({
          connectedAccountId: accountId,
          status: 'running',
        })
        .returning({ id: connectorSyncRuns.id })
    )[0];
    if (!runInsert) return { kind: 'failed', error: 'failed_to_open_run' };
    const runId = runInsert.id;

    let itemsSynced = 0;
    let runError: string | null = null;
    let newAccountStatus: 'connected' | 'expired' | 'error' | null = null;

    try {
      const connector = getConnector(row.platform as PlatformCode);
      const account: ConnectorAccount = {
        id: row.id,
        organizationId: row.organizationId,
        brandId: row.brandId,
        locationId: row.locationId,
        platform: row.platform as PlatformCode,
        externalAccountId: row.externalAccountId,
        displayName: row.displayName,
        handle: row.handle,
        status: row.status,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      };

      const result = await connector.sync(account);
      itemsSynced = result.itemsSynced;
      newAccountStatus = 'connected';
    } catch (err) {
      runError = err instanceof Error ? err.message : String(err);
      if (err instanceof ConnectorError && err.name === 'TokenExpiredError') {
        newAccountStatus = 'expired';
      } else {
        newAccountStatus = 'error';
      }
      log.warn(
        { err, accountId, platform: row.platform },
        'job.sync.failed',
      );
    }

    await tx
      .update(connectorSyncRuns)
      .set({
        status: runError ? 'failed' : 'success',
        finishedAt: new Date(),
        itemsSynced,
        errorMessage: runError,
      })
      .where(eq(connectorSyncRuns.id, runId));

    await tx
      .update(connectedAccounts)
      .set({
        lastSyncAt: new Date(),
        status: newAccountStatus ?? row.status,
        errorMessage: runError ?? null,
      })
      .where(eq(connectedAccounts.id, accountId));

    if (runError) return { kind: 'failed', runId, error: runError, itemsSynced };
    return { kind: 'ok', runId, itemsSynced };
  });
}
