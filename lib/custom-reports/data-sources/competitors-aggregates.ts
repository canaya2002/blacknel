import 'server-only';

import { sql } from 'drizzle-orm';

import type {
  DataSource,
  DataSourceContext,
  ScalarMetric,
  TimeseriesPoint,
} from './index';

/**
 * Phase 11 / C53 — `competitors_aggregates` data source. Reads
 * competitor_metrics_daily (synced by runCompetitorsSync) for share-of-voice +
 * competitor sentiment + volume trends. Org-scoped via the caller's RLS tx.
 * Share-of-voice is the vol-only ratio competitor/(competitor+own) [0,1].
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

function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function loadScalar(metric: string, ctx: DataSourceContext): Promise<ScalarMetric> {
  const start = dayStr(ctx.rangeStart);
  const end = dayStr(ctx.rangeEnd);
  if (metric === 'total_competitor_posts') {
    const [row] = normalizeRows<{ n: number | null }>(
      await ctx.tx.execute(
        sql`SELECT COALESCE(SUM(posts_count), 0)::bigint AS n
              FROM competitor_metrics_daily
             WHERE organization_id = ${ctx.orgId}
               AND day >= ${start}::date AND day <= ${end}::date`,
      ),
    );
    return { value: Number(row?.n ?? 0) };
  }
  if (metric === 'avg_share_of_voice' || metric === 'avg_competitor_sentiment') {
    const col = metric === 'avg_share_of_voice' ? sql`share_of_voice` : sql`sentiment_score`;
    const [row] = normalizeRows<{ v: number | null }>(
      await ctx.tx.execute(
        sql`SELECT AVG(${col})::float AS v
              FROM competitor_metrics_daily
             WHERE organization_id = ${ctx.orgId}
               AND day >= ${start}::date AND day <= ${end}::date`,
      ),
    );
    return { value: Math.round(Number(row?.v ?? 0) * 1000) / 1000 };
  }
  throw new Error(`competitors_aggregates: scalar '${metric}' not supported`);
}

async function loadTimeseries(
  metric: string,
  ctx: DataSourceContext,
): Promise<ReadonlyArray<TimeseriesPoint>> {
  const start = dayStr(ctx.rangeStart);
  const end = dayStr(ctx.rangeEnd);
  const expr =
    metric === 'share_of_voice'
      ? sql`AVG(share_of_voice)::float`
      : metric === 'competitor_posts'
        ? sql`COALESCE(SUM(posts_count), 0)::bigint`
        : null;
  if (!expr) throw new Error(`competitors_aggregates: timeseries '${metric}' not supported`);
  const rows = normalizeRows<{ day: string; v: number | null }>(
    await ctx.tx.execute(
      sql`SELECT to_char(day, 'YYYY-MM-DD') AS day, ${expr} AS v
            FROM competitor_metrics_daily
           WHERE organization_id = ${ctx.orgId}
             AND day >= ${start}::date AND day <= ${end}::date
           GROUP BY day
           ORDER BY day ASC`,
    ),
  );
  return rows.map((r) => ({
    t: r.day,
    v: metric === 'share_of_voice' ? Math.round(Number(r.v ?? 0) * 1000) / 1000 : Number(r.v ?? 0),
  }));
}

export const competitorsAggregatesSource: DataSource = {
  key: 'competitors_aggregates',
  capabilities: {
    scalar: ['total_competitor_posts', 'avg_share_of_voice', 'avg_competitor_sentiment'],
    timeseries: ['share_of_voice', 'competitor_posts'],
  },
  loadScalar,
  loadTimeseries,
};
