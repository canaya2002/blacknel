import 'server-only';

import { sql } from 'drizzle-orm';

import type {
  DataSource,
  DataSourceContext,
  ScalarMetric,
  TimeseriesPoint,
} from './index';

/**
 * Phase 10 / Commit 39 — `reviews_aggregates` data source.
 *
 * Avg rating + review count across the time window. BBB rows
 * (rating = 1 sentinel from C38) are EXCLUDED — they distort the
 * average. The exclusion uses `platform <> 'bbb'` because BBB is
 * complaint-resolution, not a review platform (see TODO anchor
 * `bbb-complaint-model-revisit-phase-11`).
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
  if (metric === 'avg_rating') {
    const rangeMs = ctx.rangeEnd.getTime() - ctx.rangeStart.getTime();
    const previousStart = new Date(ctx.rangeStart.getTime() - rangeMs);
    const previousEnd = ctx.rangeStart;

    const [current] = normalizeRows<{ avg_rating: number | null }>(
      await ctx.tx.execute(
        sql`SELECT AVG(rating)::float AS avg_rating
              FROM reviews
             WHERE organization_id = ${ctx.orgId}
               AND platform <> 'bbb'
               AND posted_at >= ${ctx.rangeStart}
               AND posted_at <= ${ctx.rangeEnd}`,
      ),
    );
    const [previous] = normalizeRows<{ avg_rating: number | null }>(
      await ctx.tx.execute(
        sql`SELECT AVG(rating)::float AS avg_rating
              FROM reviews
             WHERE organization_id = ${ctx.orgId}
               AND platform <> 'bbb'
               AND posted_at >= ${previousStart}
               AND posted_at <= ${previousEnd}`,
      ),
    );
    return {
      value: roundTo(current?.avg_rating ?? 0, 2),
      previousValue: roundTo(previous?.avg_rating ?? 0, 2),
    };
  }

  if (metric === 'review_count') {
    const [row] = normalizeRows<{ n: number }>(
      await ctx.tx.execute(
        sql`SELECT COUNT(*)::int AS n
              FROM reviews
             WHERE organization_id = ${ctx.orgId}
               AND posted_at >= ${ctx.rangeStart}
               AND posted_at <= ${ctx.rangeEnd}`,
      ),
    );
    return { value: Number(row?.n ?? 0) };
  }

  if (metric === 'response_rate') {
    // % of reviews in the window that have been responded to. BBB excluded.
    const [row] = normalizeRows<{ responded: number | null; total: number | null }>(
      await ctx.tx.execute(
        sql`SELECT COUNT(*) FILTER (WHERE status = 'responded')::int AS responded,
                    COUNT(*)::int AS total
               FROM reviews
              WHERE organization_id = ${ctx.orgId}
                AND platform <> 'bbb'
                AND posted_at >= ${ctx.rangeStart}
                AND posted_at <= ${ctx.rangeEnd}`,
      ),
    );
    const total = Number(row?.total ?? 0);
    const responded = Number(row?.responded ?? 0);
    return { value: total > 0 ? roundTo((responded / total) * 100, 1) : 0 };
  }

  throw new Error(`reviews_aggregates: scalar metric '${metric}' not supported`);
}

async function loadTimeseries(
  metric: string,
  ctx: DataSourceContext,
): Promise<ReadonlyArray<TimeseriesPoint>> {
  if (metric === 'avg_rating' || metric === 'review_count') {
    const select =
      metric === 'avg_rating'
        ? sql`AVG(rating)::float AS v`
        : sql`COUNT(*)::int AS v`;
    const rows = normalizeRows<{ day: string; v: number | null }>(
      await ctx.tx.execute(
        sql`SELECT to_char(date_trunc('day', posted_at), 'YYYY-MM-DD') AS day,
                    ${select}
               FROM reviews
              WHERE organization_id = ${ctx.orgId}
                AND platform <> 'bbb'
                AND posted_at >= ${ctx.rangeStart}
                AND posted_at <= ${ctx.rangeEnd}
              GROUP BY day
              ORDER BY day ASC`,
      ),
    );
    return rows.map((r) => ({ t: r.day, v: roundTo(Number(r.v ?? 0), 2) }));
  }
  throw new Error(`reviews_aggregates: timeseries '${metric}' not supported`);
}

function roundTo(v: number, digits: number): number {
  const m = 10 ** digits;
  return Math.round(v * m) / m;
}

export const reviewsAggregatesSource: DataSource = {
  key: 'reviews_aggregates',
  capabilities: {
    scalar: ['avg_rating', 'review_count', 'response_rate'],
    timeseries: ['avg_rating', 'review_count'],
  },
  loadScalar,
  loadTimeseries,
};
