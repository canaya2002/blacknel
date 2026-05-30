import 'server-only';

import { sql } from 'drizzle-orm';

import type {
  BucketEntry,
  DataSource,
  DataSourceContext,
  ScalarMetric,
  TimeseriesPoint,
} from './index';

/**
 * Phase 10 / Commit 39 — `listening_aggregates` data source.
 *
 * Total mention count + distribution by sentiment. Reuses the
 * 4-value `inbox_sentiment` enum (Phase 9 / Commit 33).
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
  if (metric === 'total_mentions') {
    const [row] = normalizeRows<{ n: number }>(
      await ctx.tx.execute(
        sql`SELECT COUNT(*)::int AS n
              FROM listening_mentions
             WHERE organization_id = ${ctx.orgId}
               AND captured_at >= ${ctx.rangeStart}
               AND captured_at <= ${ctx.rangeEnd}`,
      ),
    );
    return { value: Number(row?.n ?? 0) };
  }
  throw new Error(`listening_aggregates: scalar '${metric}' not supported`);
}

async function loadBuckets(
  groupBy: string,
  ctx: DataSourceContext,
): Promise<ReadonlyArray<BucketEntry>> {
  if (groupBy === 'sentiment') {
    const rows = normalizeRows<{ key: string; v: number }>(
      await ctx.tx.execute(
        sql`SELECT sentiment::text AS key, COUNT(*)::int AS v
              FROM listening_mentions
             WHERE organization_id = ${ctx.orgId}
               AND captured_at >= ${ctx.rangeStart}
               AND captured_at <= ${ctx.rangeEnd}
             GROUP BY sentiment
             ORDER BY v DESC`,
      ),
    );
    return rows.map((r) => ({ key: r.key, value: Number(r.v) }));
  }
  throw new Error(`listening_aggregates: buckets '${groupBy}' not supported`);
}

async function loadTimeseries(
  metric: string,
  ctx: DataSourceContext,
): Promise<ReadonlyArray<TimeseriesPoint>> {
  // mention_volume: daily count. net_sentiment: daily (positives − negatives).
  const expr =
    metric === 'mention_volume'
      ? sql`COUNT(*)::int`
      : metric === 'net_sentiment'
        ? sql`(COUNT(*) FILTER (WHERE sentiment = 'positive') - COUNT(*) FILTER (WHERE sentiment = 'negative'))::int`
        : null;
  if (!expr) throw new Error(`listening_aggregates: timeseries '${metric}' not supported`);
  const rows = normalizeRows<{ day: string; v: number | null }>(
    await ctx.tx.execute(
      sql`SELECT to_char(date_trunc('day', captured_at), 'YYYY-MM-DD') AS day,
                  ${expr} AS v
             FROM listening_mentions
            WHERE organization_id = ${ctx.orgId}
              AND captured_at >= ${ctx.rangeStart}
              AND captured_at <= ${ctx.rangeEnd}
            GROUP BY day
            ORDER BY day ASC`,
    ),
  );
  return rows.map((r) => ({ t: r.day, v: Number(r.v ?? 0) }));
}

export const listeningAggregatesSource: DataSource = {
  key: 'listening_aggregates',
  capabilities: {
    scalar: ['total_mentions'],
    timeseries: ['mention_volume', 'net_sentiment'],
    buckets: ['sentiment'],
  },
  loadScalar,
  loadTimeseries,
  loadBuckets,
};
