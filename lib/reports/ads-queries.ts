import 'server-only';

import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import { adsAccounts, adsSpendDaily } from '@/lib/db/schema';

import {
  computeRange,
  makeDelta,
  type DeltaShape,
  type ReportPeriod,
} from './period';

/**
 * Ads section query for /reports (Phase 8 / Commit 29).
 *
 * Mirrors the Overview shape (`{current, previous, delta, trend}`
 * per KPI) so the same `<ReportKpiCard />` renders both tabs.
 * Reads only from `ads_spend_daily` + `ads_accounts` (Commit 28
 * tables, additive — no Phase 1-7 surface touched).
 *
 * Brand filter is honored via `ads_accounts.brand_id`: when set,
 * we restrict to spend rows whose account was tagged with that
 * brand at scan time. This is the same shape as the
 * Overview/posts brand filter (read on the parent table, not
 * the daily row).
 */

export interface AdsReportPayload {
  readonly spendUsdCents: DeltaShape;
  readonly impressions: DeltaShape;
  readonly clicks: DeltaShape;
  /** Stored as 0..1 (basis 1 = 100%). */
  readonly ctr: DeltaShape;
  readonly accountsConnected: number;
}

export interface LoadAdsReportOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly period: ReportPeriod;
  readonly brandId: string | null;
  readonly now: Date;
}

export async function loadAdsReport(
  opts: LoadAdsReportOpts,
): Promise<AdsReportPayload> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    loadAdsReportWithTx(tx, opts),
  );
}

interface PeriodTotals {
  spend: number;
  impressions: number;
  clicks: number;
}

async function fetchTotals(
  tx: AnyPgTx,
  orgId: string,
  brandId: string | null,
  start: Date,
  end: Date,
): Promise<PeriodTotals> {
  type Row = {
    spend: string | number | null;
    impressions: string | number | null;
    clicks: string | number | null;
  };
  const startIso = start.toISOString().slice(0, 10);
  const endIso = end.toISOString().slice(0, 10);

  const rows: Row[] = await tx
    .select({
      spend: sql<number>`coalesce(sum(${adsSpendDaily.spendUsdCents}), 0)`,
      impressions: sql<number>`coalesce(sum(${adsSpendDaily.impressions}), 0)`,
      clicks: sql<number>`coalesce(sum(${adsSpendDaily.clicks}), 0)`,
    })
    .from(adsSpendDaily)
    .leftJoin(adsAccounts, eq(adsAccounts.id, adsSpendDaily.adsAccountId))
    .where(
      and(
        eq(adsSpendDaily.organizationId, orgId),
        gte(adsSpendDaily.date, startIso),
        lte(adsSpendDaily.date, endIso),
        brandId ? eq(adsAccounts.brandId, brandId) : sql`true`,
      ),
    );
  const row = rows[0];
  return {
    spend: Number(row?.spend ?? 0),
    impressions: Number(row?.impressions ?? 0),
    clicks: Number(row?.clicks ?? 0),
  };
}

export async function loadAdsReportWithTx(
  tx: AnyPgTx,
  opts: LoadAdsReportOpts,
): Promise<AdsReportPayload> {
  const range = computeRange(opts.period, opts.now);

  const [cur, prev, accountsAgg] = await Promise.all([
    fetchTotals(tx, opts.orgId, opts.brandId, range.currentStart, range.currentEnd),
    fetchTotals(tx, opts.orgId, opts.brandId, range.previousStart, range.previousEnd),
    tx
      .select({
        n: sql<number>`count(*) filter (where ${adsAccounts.status} = 'connected')::int`,
      })
      .from(adsAccounts)
      .where(eq(adsAccounts.organizationId, opts.orgId)) as Promise<
      Array<{ n: number | string | null }>
    >,
  ]);

  const curCtr =
    cur.impressions > 0 ? (cur.clicks / cur.impressions) * 100 : 0;
  const prevCtr =
    prev.impressions > 0 ? (prev.clicks / prev.impressions) * 100 : 0;

  return {
    spendUsdCents: makeDelta(cur.spend, prev.spend),
    impressions: makeDelta(cur.impressions, prev.impressions),
    clicks: makeDelta(cur.clicks, prev.clicks),
    ctr: makeDelta(curCtr, prevCtr),
    accountsConnected: Number(accountsAgg[0]?.n ?? 0),
  };
}

/**
 * Convenience for the CSV export — flat array of rows, one per
 * KPI, no trend/tone columns.
 */
export function flattenAdsReportForCsv(
  payload: AdsReportPayload,
  period: ReportPeriod,
): Array<{
  metric: string;
  current: string;
  previous: string;
  delta: string;
  trend: string;
}> {
  return [
    {
      metric: 'spend_usd_cents',
      ...rowOf(payload.spendUsdCents),
    },
    {
      metric: 'impressions',
      ...rowOf(payload.impressions),
    },
    {
      metric: 'clicks',
      ...rowOf(payload.clicks),
    },
    {
      metric: 'ctr_pct',
      ...rowOf(payload.ctr),
    },
    {
      metric: 'accounts_connected',
      current: String(payload.accountsConnected),
      previous: '',
      delta: '',
      trend: '',
    },
    {
      metric: 'period',
      current: period,
      previous: '',
      delta: '',
      trend: '',
    },
  ];
}

function rowOf(d: DeltaShape): {
  current: string;
  previous: string;
  delta: string;
  trend: string;
} {
  return {
    current: d.current == null ? '' : String(d.current),
    previous: d.previous == null ? '' : String(d.previous),
    delta: d.delta == null ? '' : String(d.delta),
    trend: d.trend,
  };
}
