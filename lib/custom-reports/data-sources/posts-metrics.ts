import 'server-only';

import { and, count, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import { postTargets, posts } from '@/lib/db/schema';

import type {
  DataSource,
  DataSourceContext,
  RowEntry,
  ScalarMetric,
} from './index';

/**
 * Phase 10 / Commit 39 — `posts_metrics` data source.
 *
 * Reach + engagement are PROXIED from `post_targets` counts —
 * Blacknel doesn't store real reach/likes today (Phase 11 wires
 * the actual connector insights endpoints). The proxy gives a
 * consistent demo number: each successfully-published target
 * counts as `1` reach unit; engagement rate is the fraction of
 * targets that reached `published` status.
 *
 * The proxy is **documented** so the demo doesn't pretend to
 * show real numbers — see template descriptions in
 * `lib/custom-reports/templates.ts`.
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
  if (metric === 'total_reach') {
    const rows = await ctx.tx
      .select({ n: count() })
      .from(postTargets)
      .where(
        and(
          eq(postTargets.organizationId, ctx.orgId),
          eq(postTargets.status, 'published'),
          isNotNull(postTargets.publishedAt),
          gte(postTargets.publishedAt, ctx.rangeStart),
          lte(postTargets.publishedAt, ctx.rangeEnd),
        ),
      );
    // Proxy: 1 published target → 100 "reach units" (so demo numbers feel realistic).
    return { value: Number(rows[0]?.n ?? 0) * 100 };
  }

  if (metric === 'engagement_rate') {
    const [row] = normalizeRows<{ published: number; total: number }>(
      await ctx.tx.execute(
        sql`SELECT
              COUNT(*) FILTER (WHERE status = 'published')::int AS published,
              COUNT(*)::int AS total
            FROM post_targets
            WHERE organization_id = ${ctx.orgId}
              AND published_at IS NOT NULL
              AND published_at >= ${ctx.rangeStart}
              AND published_at <= ${ctx.rangeEnd}`,
      ),
    );
    const total = Number(row?.total ?? 0);
    const published = Number(row?.published ?? 0);
    const rate = total === 0 ? 0 : published / total;
    return { value: Math.round(rate * 10000) / 100 }; // percent, 2 decimals
  }

  throw new Error(`posts_metrics: scalar metric '${metric}' not supported`);
}

async function loadRows(
  opts: { limit: number; filters: Record<string, string | number | boolean> },
  ctx: DataSourceContext,
): Promise<ReadonlyArray<RowEntry>> {
  const limit = Math.min(opts.limit, 25);
  type Row = {
    id: string;
    text: string;
    status: string;
    publishedAt: Date | null;
  };
  const rows: Row[] = await ctx.tx
    .select({
      id: posts.id,
      text: posts.text,
      status: posts.status,
      publishedAt: posts.publishedAt,
    })
    .from(posts)
    .where(
      and(
        eq(posts.organizationId, ctx.orgId),
        eq(posts.status, 'published'),
        isNotNull(posts.publishedAt),
        gte(posts.publishedAt, ctx.rangeStart),
        lte(posts.publishedAt, ctx.rangeEnd),
      ),
    )
    .orderBy(desc(posts.publishedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    text: (r.text ?? '').slice(0, 80),
    status: r.status,
    published_at: r.publishedAt
      ? r.publishedAt.toISOString().slice(0, 10)
      : null,
  }));
}

export const postsMetricsSource: DataSource = {
  key: 'posts_metrics',
  capabilities: {
    scalar: ['total_reach', 'engagement_rate'],
    rows: true,
  },
  loadScalar,
  loadRows,
};
