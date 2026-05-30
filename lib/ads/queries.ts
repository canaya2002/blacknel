import 'server-only';

import { and, desc, eq, gte, sql, type SQL } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import {
  adsAccounts,
  adsSpendDaily,
  brands,
} from '@/lib/db/schema';

/**
 * Read layer for /ads — Phase 8 / Commit 28.
 *
 * Pure aggregations over `ads_accounts` + `ads_spend_daily`.
 * No writes here — those live in Server Actions
 * (`app/(app)/ads/actions.ts`).
 *
 * **USD rollups everywhere.** The dashboard shows `spend_usd_cents`
 * (frozen at-insert) so a customer with mixed-currency accounts
 * sees comparable totals. Native `spend_cents` stays available
 * per-row for the account-detail drawer (Phase 9).
 *
 * **Phase 8 charter rule.** This file ONLY reads from
 * `ads_accounts` / `ads_spend_daily` (Commit 28 schema) and from
 * `brands` (Phase 1, read-only). No Phase 1-7 modifications.
 */

export interface AdsAccountRow {
  readonly id: string;
  readonly platform: 'google' | 'meta' | 'tiktok';
  readonly externalAccountId: string;
  readonly accountName: string | null;
  readonly currency: string;
  readonly status: 'connected' | 'disconnected' | 'error';
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly lastSyncAt: Date | null;
  readonly spendUsdCents30d: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60_000;

export async function listAdsAccounts(ctx: {
  orgId: string;
  userId: string;
}): Promise<AdsAccountRow[]> {
  return dbAs(ctx, (tx) => listAdsAccountsWithTx(tx, ctx.orgId));
}

export async function listAdsAccountsWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<AdsAccountRow[]> {
  const since = new Date(Date.now() - THIRTY_DAYS_MS);

  type Row = {
    id: string;
    platform: 'google' | 'meta' | 'tiktok';
    externalAccountId: string;
    accountName: string | null;
    currency: string;
    status: 'connected' | 'disconnected' | 'error';
    brandId: string | null;
    brandName: string | null;
    lastSyncAt: Date | null;
    spendUsdCents30d: string | number | null;
  };

  const rows: Row[] = await tx
    .select({
      id: adsAccounts.id,
      platform: adsAccounts.platform,
      externalAccountId: adsAccounts.externalAccountId,
      accountName: adsAccounts.accountName,
      currency: adsAccounts.currency,
      status: adsAccounts.status,
      brandId: adsAccounts.brandId,
      brandName: brands.name,
      lastSyncAt: adsAccounts.lastSyncAt,
      spendUsdCents30d: sql<number>`coalesce(sum(${adsSpendDaily.spendUsdCents}) filter (where ${adsSpendDaily.date} >= ${since.toISOString().slice(0, 10)}), 0)`,
    })
    .from(adsAccounts)
    .leftJoin(brands, eq(brands.id, adsAccounts.brandId))
    .leftJoin(adsSpendDaily, eq(adsSpendDaily.adsAccountId, adsAccounts.id))
    .where(eq(adsAccounts.organizationId, orgId))
    .groupBy(adsAccounts.id, brands.name)
    .orderBy(desc(adsAccounts.connectedAt));

  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    externalAccountId: r.externalAccountId,
    accountName: r.accountName,
    currency: r.currency,
    status: r.status,
    brandId: r.brandId,
    brandName: r.brandName,
    lastSyncAt: r.lastSyncAt,
    spendUsdCents30d: Number(r.spendUsdCents30d ?? 0),
  }));
}

export interface AdsOverview {
  readonly accountsConnected: number;
  readonly spendUsdCents30d: number;
  readonly impressions30d: number;
  readonly clicks30d: number;
  readonly lastSyncAt: Date | null;
}

export async function getAdsOverviewWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<AdsOverview> {
  const since = new Date(Date.now() - THIRTY_DAYS_MS);
  const sinceIso = since.toISOString().slice(0, 10);

  const [accountsAgg] = await tx
    .select({
      connected: sql<number>`count(*) filter (where ${adsAccounts.status} = 'connected')`,
      lastSyncAt: sql<Date | null>`max(${adsAccounts.lastSyncAt})`,
    })
    .from(adsAccounts)
    .where(eq(adsAccounts.organizationId, orgId));

  const [spendAgg] = await tx
    .select({
      spendUsdCents: sql<number>`coalesce(sum(${adsSpendDaily.spendUsdCents}), 0)`,
      impressions: sql<number>`coalesce(sum(${adsSpendDaily.impressions}), 0)`,
      clicks: sql<number>`coalesce(sum(${adsSpendDaily.clicks}), 0)`,
    })
    .from(adsSpendDaily)
    .where(
      and(
        eq(adsSpendDaily.organizationId, orgId),
        gte(adsSpendDaily.date, sinceIso),
      ),
    );

  return {
    accountsConnected: Number(accountsAgg?.connected ?? 0),
    spendUsdCents30d: Number(spendAgg?.spendUsdCents ?? 0),
    impressions30d: Number(spendAgg?.impressions ?? 0),
    clicks30d: Number(spendAgg?.clicks ?? 0),
    lastSyncAt: (accountsAgg?.lastSyncAt as Date | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Single-account drill-down (Commit 30)
// ---------------------------------------------------------------------------

export interface AdsAccountDetail {
  readonly id: string;
  readonly platform: 'google' | 'meta' | 'tiktok';
  readonly externalAccountId: string;
  readonly accountName: string | null;
  readonly currency: string;
  readonly status: 'connected' | 'disconnected' | 'error';
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly connectedAt: Date;
  readonly lastSyncAt: Date | null;
}

export async function getAdsAccountDetailWithTx(
  tx: AnyPgTx,
  orgId: string,
  adsAccountId: string,
): Promise<AdsAccountDetail | null> {
  type Row = {
    id: string;
    platform: 'google' | 'meta' | 'tiktok';
    externalAccountId: string;
    accountName: string | null;
    currency: string;
    status: 'connected' | 'disconnected' | 'error';
    brandId: string | null;
    brandName: string | null;
    connectedAt: Date;
    lastSyncAt: Date | null;
  };
  const rows: Row[] = await tx
    .select({
      id: adsAccounts.id,
      platform: adsAccounts.platform,
      externalAccountId: adsAccounts.externalAccountId,
      accountName: adsAccounts.accountName,
      currency: adsAccounts.currency,
      status: adsAccounts.status,
      brandId: adsAccounts.brandId,
      brandName: brands.name,
      connectedAt: adsAccounts.connectedAt,
      lastSyncAt: adsAccounts.lastSyncAt,
    })
    .from(adsAccounts)
    .leftJoin(brands, eq(brands.id, adsAccounts.brandId))
    .where(
      and(
        eq(adsAccounts.id, adsAccountId),
        eq(adsAccounts.organizationId, orgId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface AdsAccountDailyRow {
  readonly date: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly spendCents: number;
  readonly spendUsdCents: number;
  readonly currency: string;
}

/**
 * Per-day rollup for the last 30 days of one account. Each row is
 * one date with totals across all platform_campaign_ids on that
 * day. Drill-down page table.
 */
export async function listAdsAccountDailyWithTx(
  tx: AnyPgTx,
  orgId: string,
  adsAccountId: string,
): Promise<AdsAccountDailyRow[]> {
  const since = new Date(Date.now() - THIRTY_DAYS_MS);
  const sinceIso = since.toISOString().slice(0, 10);

  type Row = {
    date: string;
    impressions: number | string | null;
    clicks: number | string | null;
    spendCents: number | string | null;
    spendUsdCents: number | string | null;
    currency: string;
  };
  const rows: Row[] = await tx
    .select({
      date: adsSpendDaily.date,
      impressions: sql<number>`sum(${adsSpendDaily.impressions})::int`,
      clicks: sql<number>`sum(${adsSpendDaily.clicks})::int`,
      spendCents: sql<number>`sum(${adsSpendDaily.spendCents})::int`,
      spendUsdCents: sql<number>`sum(${adsSpendDaily.spendUsdCents})::int`,
      currency: adsSpendDaily.currency,
    })
    .from(adsSpendDaily)
    .where(
      and(
        eq(adsSpendDaily.organizationId, orgId),
        eq(adsSpendDaily.adsAccountId, adsAccountId),
        gte(adsSpendDaily.date, sinceIso),
      ),
    )
    .groupBy(adsSpendDaily.date, adsSpendDaily.currency)
    .orderBy(desc(adsSpendDaily.date));

  return rows.map((r) => ({
    date: r.date,
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    spendCents: Number(r.spendCents ?? 0),
    spendUsdCents: Number(r.spendUsdCents ?? 0),
    currency: r.currency,
  }));
}

// Touch unused so future filter() helpers can pick them up.
void (null as SQL | null);
