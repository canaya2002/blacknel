import 'server-only';

import { sql } from 'drizzle-orm';

import type {
  DataSource,
  DataSourceContext,
  ScalarMetric,
  TimeseriesPoint,
} from './index';

/**
 * Phase 10 / Commit 39 — `ads_spend` data source.
 *
 * Reads `ads_spend_daily` rolled up by org. USD-cents column is the
 * source of truth — convert to dollars at the boundary for display.
 */

function normalizeRows<T>(result: unknown): T[] {
  if (
    typeof result === 'object' &&
    result !== null &&
    'rows' in result &&
    Array.isArray((result as { rows: unknown[] }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return result as T[];
}

async function loadScalar(
  metric: string,
  ctx: DataSourceContext,
): Promise<ScalarMetric> {
  if (metric === 'spend_usd') {
    const [row] = normalizeRows<{ cents: number | null }>(
      await ctx.tx.execute(
        sql`SELECT COALESCE(SUM(spend_usd_cents), 0)::bigint AS cents
              FROM ads_spend_daily
             WHERE organization_id = ${ctx.orgId}
               AND date >= ${ctx.rangeStart.toISOString().slice(0, 10)}::date
               AND date <= ${ctx.rangeEnd.toISOString().slice(0, 10)}::date`,
      ),
    );
    return { value: Math.round(Number(row?.cents ?? 0) / 100) };
  }
  if (metric === 'conversions') {
    const [row] = normalizeRows<{ n: number | null }>(
      await ctx.tx.execute(
        sql`SELECT COALESCE(SUM(conversions), 0)::bigint AS n
              FROM ads_spend_daily
             WHERE organization_id = ${ctx.orgId}
               AND date >= ${ctx.rangeStart.toISOString().slice(0, 10)}::date
               AND date <= ${ctx.rangeEnd.toISOString().slice(0, 10)}::date`,
      ),
    );
    return { value: Number(row?.n ?? 0) };
  }
  throw new Error(`ads_spend: scalar metric '${metric}' not supported`);
}

async function loadTimeseries(
  metric: string,
  ctx: DataSourceContext,
): Promise<ReadonlyArray<TimeseriesPoint>> {
  if (metric === 'spend_usd') {
    const rows = normalizeRows<{ day: string; v: number | null }>(
      await ctx.tx.execute(
        sql`SELECT to_char(date, 'YYYY-MM-DD') AS day,
                    COALESCE(SUM(spend_usd_cents), 0)::bigint AS v
               FROM ads_spend_daily
              WHERE organization_id = ${ctx.orgId}
                AND date >= ${ctx.rangeStart.toISOString().slice(0, 10)}::date
                AND date <= ${ctx.rangeEnd.toISOString().slice(0, 10)}::date
              GROUP BY date
              ORDER BY date ASC`,
      ),
    );
    return rows.map((r) => ({
      t: r.day,
      v: Math.round(Number(r.v ?? 0) / 100),
    }));
  }
  if (metric === 'conversions') {
    const rows = normalizeRows<{ day: string; v: number | null }>(
      await ctx.tx.execute(
        sql`SELECT to_char(date, 'YYYY-MM-DD') AS day,
                    COALESCE(SUM(conversions), 0)::bigint AS v
               FROM ads_spend_daily
              WHERE organization_id = ${ctx.orgId}
                AND date >= ${ctx.rangeStart.toISOString().slice(0, 10)}::date
                AND date <= ${ctx.rangeEnd.toISOString().slice(0, 10)}::date
              GROUP BY date
              ORDER BY date ASC`,
      ),
    );
    return rows.map((r) => ({ t: r.day, v: Number(r.v ?? 0) }));
  }
  throw new Error(`ads_spend: timeseries '${metric}' not supported`);
}

export const adsSpendSource: DataSource = {
  key: 'ads_spend',
  capabilities: {
    scalar: ['spend_usd', 'conversions'],
    timeseries: ['spend_usd', 'conversions'],
  },
  loadScalar,
  loadTimeseries,
};
