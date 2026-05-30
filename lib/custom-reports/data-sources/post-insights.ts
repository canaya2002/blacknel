import 'server-only';

import { sql } from 'drizzle-orm';

import type {
  DataSource,
  DataSourceContext,
  ScalarMetric,
  TimeseriesPoint,
} from './index';

/**
 * Phase 11 / C52 — `post_insights` data source. REAL per-post engagement from
 * the post_insights table (synced from platform APIs), unlike the legacy
 * `posts_metrics` proxy (publish counts). Buckets engagement by the post's
 * publish date. Org-scoped via the caller's RLS tx.
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

const SCALAR_COLUMN: Record<string, string> = {
  total_reach: 'reach',
  total_impressions: 'impressions',
  total_engagement: 'engagement',
  total_likes: 'likes',
  total_comments: 'comments',
};

const TIMESERIES_COLUMN: Record<string, string> = {
  engagement: 'engagement',
  reach: 'reach',
  impressions: 'impressions',
};

async function loadScalar(metric: string, ctx: DataSourceContext): Promise<ScalarMetric> {
  const col = SCALAR_COLUMN[metric];
  if (!col) throw new Error(`post_insights: scalar metric '${metric}' not supported`);
  // Column name is from a fixed allowlist (never user input) → safe to inline.
  const [row] = normalizeRows<{ n: number | null }>(
    await ctx.tx.execute(
      sql`SELECT COALESCE(SUM(${sql.raw(col)}), 0)::bigint AS n
            FROM post_insights
           WHERE organization_id = ${ctx.orgId}
             AND posted_at >= ${ctx.rangeStart}
             AND posted_at <= ${ctx.rangeEnd}`,
    ),
  );
  return { value: Number(row?.n ?? 0) };
}

async function loadTimeseries(
  metric: string,
  ctx: DataSourceContext,
): Promise<ReadonlyArray<TimeseriesPoint>> {
  const col = TIMESERIES_COLUMN[metric];
  if (!col) throw new Error(`post_insights: timeseries '${metric}' not supported`);
  const rows = normalizeRows<{ day: string; v: number | null }>(
    await ctx.tx.execute(
      sql`SELECT to_char(date_trunc('day', posted_at), 'YYYY-MM-DD') AS day,
                  COALESCE(SUM(${sql.raw(col)}), 0)::bigint AS v
             FROM post_insights
            WHERE organization_id = ${ctx.orgId}
              AND posted_at >= ${ctx.rangeStart}
              AND posted_at <= ${ctx.rangeEnd}
            GROUP BY day
            ORDER BY day ASC`,
    ),
  );
  return rows.map((r) => ({ t: r.day, v: Number(r.v ?? 0) }));
}

export const postInsightsSource: DataSource = {
  key: 'post_insights',
  capabilities: {
    scalar: ['total_reach', 'total_impressions', 'total_engagement', 'total_likes', 'total_comments'],
    timeseries: ['engagement', 'reach', 'impressions'],
  },
  loadScalar,
  loadTimeseries,
};
