import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { dbAdmin, dbAsOrg, type AnyPgTx } from '@/lib/db/client';
import {
  adsAccounts,
  adsSpendDaily,
  auditEvents,
} from '@/lib/db/schema';
import { log } from '@/lib/log';
import { ok, type Result } from '@/lib/types/result';
import { toUsdCents } from '@/lib/ads/fx-rates';
import { isRealAdsEnabled, resolveAdsConnector } from '@/lib/ads-connectors/dispatch';
import { readAccountTokens } from '@/lib/connectors/tokens';

/**
 * Ads-sync producer — Phase 8 / Commit 28.
 *
 * For every `ads_accounts` row with `status='connected'`, pulls
 * the last 2 days (D-28-2) of daily spend rows from its
 * platform's connector and upserts them into
 * `ads_spend_daily`. The 2d window catches late-arriving
 * attribution revisions: both Google Ads and Meta sometimes
 * adjust day-N's clicks/conversions for ~48h after the fact.
 *
 * **Determinism contract.** Mock connectors emit the same numbers
 * for `(account, date, campaign)` on every call (Phase 8 /
 * Ajuste 2). Combined with `ON CONFLICT … DO UPDATE`, re-running
 * `runAdsSyncTick()` on the same date range is idempotent: the
 * `updated_at` column nudges forward but the data doesn't churn.
 *
 * **FX freezing.** Each row stores BOTH `spend_cents` (native)
 * AND `spend_usd_cents` (converted at-insert via
 * `lib/ads/fx-rates.ts`). Historical USD does NOT recompute when
 * the rate table changes — that's the right semantics for
 * "what did you actually pay back then in USD-equivalent."
 *
 * **System actor.** `audit_events.user_id = NULL`,
 * `actor_type = 'system'`. Matches the publish + crisis-scan
 * patterns; `instrumentation.ts` is the only caller in dev.
 */

const SYNC_WINDOW_DAYS = 2;

export interface AdsSyncDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  /**
   * Org-scoped tx (C50) — only used on the REAL path to read a connection's
   * encrypted token under its org RLS. Optional so the mock path / existing
   * callers ({asAdmin, now}) keep working untouched.
   */
  orgTx?: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  now: () => Date;
}

const defaultDeps: AdsSyncDeps = {
  asAdmin: (fn) => dbAdmin(fn),
  orgTx: (orgId, fn) => dbAsOrg(orgId, fn),
  now: () => new Date(),
};

export interface AdsSyncReport {
  readonly accountsScanned: number;
  readonly rowsUpserted: number;
  readonly accountsErrored: number;
  readonly durationMs: number;
}

export async function runAdsSyncTick(
  deps: AdsSyncDeps = defaultDeps,
): Promise<Result<AdsSyncReport>> {
  const startMs = deps.now().getTime();
  type AccountRow = {
    id: string;
    organizationId: string;
    platform: 'google' | 'meta';
    externalAccountId: string;
    currency: string;
    metadata: unknown;
  };
  const accounts = await deps.asAdmin<AccountRow[]>((tx) =>
    tx
      .select({
        id: adsAccounts.id,
        organizationId: adsAccounts.organizationId,
        platform: adsAccounts.platform,
        externalAccountId: adsAccounts.externalAccountId,
        currency: adsAccounts.currency,
        metadata: adsAccounts.metadata,
      })
      .from(adsAccounts)
      .where(eq(adsAccounts.status, 'connected'))
      .limit(500),
  );

  const range = computeRange(deps.now());
  let rowsUpserted = 0;
  let accountsErrored = 0;

  for (const account of accounts) {
    try {
      const upserted = await syncOneAccount(deps, account, range);
      rowsUpserted += upserted;
    } catch (e) {
      accountsErrored += 1;
      log.error(
        {
          err: (e as Error).message,
          adsAccountId: account.id,
          platform: account.platform,
        },
        'ads.sync.account_failed',
      );
      // Don't flip status='error' on a transient failure — wait
      // for a manual disconnect or repeated Phase-11 OAuth errors.
    }
  }

  const report: AdsSyncReport = {
    accountsScanned: accounts.length,
    rowsUpserted,
    accountsErrored,
    durationMs: deps.now().getTime() - startMs,
  };
  log.info({ tick: 'ads-sync', ...report }, 'ads sync tick completed');
  return ok(report);
}

interface SyncAccount {
  id: string;
  organizationId: string;
  platform: 'google' | 'meta';
  externalAccountId: string;
  currency: string;
  metadata?: unknown;
}

interface DateRange {
  from: string;
  to: string;
}

function computeRange(now: Date): DateRange {
  const end = new Date(now.getTime());
  const start = new Date(now.getTime());
  start.setUTCDate(start.getUTCDate() - (SYNC_WINDOW_DAYS - 1));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

async function syncOneAccount(
  deps: AdsSyncDeps,
  account: SyncAccount,
  range: DateRange,
): Promise<number> {
  // Real path threads the platform token (from the linked connection) onto the
  // account; mock ignores it. Token read happens under the org's RLS.
  const connectedAccountId = (account.metadata as { connectedAccountId?: string } | null)
    ?.connectedAccountId;
  let accessToken: string | undefined;
  if (connectedAccountId && (await isRealAdsEnabled(account.platform))) {
    const orgTx = deps.orgTx ?? ((orgId, fn) => dbAsOrg(orgId, fn));
    const tokens = await orgTx(account.organizationId, (tx) =>
      readAccountTokens(tx, connectedAccountId),
    );
    accessToken = tokens?.accessToken;
  }

  const connector = await resolveAdsConnector(account.platform);
  const rows = await connector.fetchDailySpend(
    {
      adsAccountId: account.id,
      externalAccountId: account.externalAccountId,
      currency: account.currency,
      ...(accessToken ? { accessToken } : {}),
    },
    range,
  );

  if (rows.length === 0) {
    await touchLastSyncAt(deps, account.id);
    return 0;
  }

  // Build the value list for one bulk INSERT … ON CONFLICT.
  const values = rows.map((r) => ({
    organizationId: account.organizationId,
    adsAccountId: account.id,
    platformCampaignId: r.platformCampaignId,
    date: r.date,
    impressions: r.impressions,
    clicks: r.clicks,
    spendCents: r.spendCents,
    spendUsdCents: toUsdCents(r.spendCents, account.currency),
    conversions: r.conversions ?? 0,
    currency: account.currency,
  }));

  await deps.asAdmin((tx) =>
    tx
      .insert(adsSpendDaily)
      .values(values)
      .onConflictDoUpdate({
        target: [
          adsSpendDaily.organizationId,
          adsSpendDaily.adsAccountId,
          adsSpendDaily.platformCampaignId,
          adsSpendDaily.date,
          adsSpendDaily.currency,
        ],
        set: {
          impressions: sql`excluded.impressions`,
          clicks: sql`excluded.clicks`,
          spendCents: sql`excluded.spend_cents`,
          spendUsdCents: sql`excluded.spend_usd_cents`,
          conversions: sql`excluded.conversions`,
          updatedAt: sql`now()`,
        },
      }),
  );

  await touchLastSyncAt(deps, account.id);
  await writeSystemAudit(deps, account.organizationId, account.id, rows.length);
  return rows.length;
}

async function touchLastSyncAt(deps: AdsSyncDeps, accountId: string): Promise<void> {
  await deps.asAdmin((tx) =>
    tx
      .update(adsAccounts)
      .set({ lastSyncAt: deps.now(), updatedAt: deps.now() })
      .where(eq(adsAccounts.id, accountId)),
  );
}

async function writeSystemAudit(
  deps: AdsSyncDeps,
  orgId: string,
  adsAccountId: string,
  rowsUpserted: number,
): Promise<void> {
  try {
    await deps.asAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: orgId,
        userId: null,
        actorType: 'system',
        action: 'ads.sync.completed',
        entityType: 'ads_account',
        entityId: adsAccountId,
        after: { rowsUpserted },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    log.error(
      { cause, adsAccountId },
      'ads.sync.audit.failed',
    );
  }
}

// Touch unused symbols to keep them live for downstream expansion.
void and;
