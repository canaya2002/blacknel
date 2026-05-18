import 'server-only';

import { sql } from 'drizzle-orm';

import type {
  BucketEntry,
  DataSource,
  DataSourceContext,
  ScalarMetric,
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

export const listeningAggregatesSource: DataSource = {
  key: 'listening_aggregates',
  capabilities: {
    scalar: ['total_mentions'],
    buckets: ['sentiment'],
  },
  loadScalar,
  loadBuckets,
};
