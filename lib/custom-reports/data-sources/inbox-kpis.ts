import 'server-only';

import { and, count, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';

import { inboxThreads } from '@/lib/db/schema';

import type {
  DataSource,
  DataSourceContext,
  ScalarMetric,
  TimeseriesPoint,
  RowEntry,
} from './index';

/**
 * Phase 10 / Commit 39 — `inbox_kpis` data source.
 *
 * Lean wrappers around `inbox_threads`. Avg response time, threads
 * opened/closed counts, pending approvals as rows. RLS-aware
 * because `ctx.tx` was obtained via `runAs(...)` from the caller.
 *
 * # Render-only payloads
 *
 * Output is shaped for renderer consumption only — never recurse
 * into widget config or compose into WHERE clauses.
 */

async function loadScalar(
  metric: string,
  ctx: DataSourceContext,
): Promise<ScalarMetric> {
  if (metric === 'avg_response_time_minutes') {
    const rangeMs = ctx.rangeEnd.getTime() - ctx.rangeStart.getTime();
    const previousStart = new Date(ctx.rangeStart.getTime() - rangeMs);
    const previousEnd = ctx.rangeStart;

    const [current] = normalizeRows<{ avg_min: number | null }>(
      await ctx.tx.execute(
        sql`SELECT AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 60)::float AS avg_min
              FROM inbox_threads
             WHERE organization_id = ${ctx.orgId}
               AND closed_at IS NOT NULL
               AND created_at >= ${ctx.rangeStart}
               AND created_at <= ${ctx.rangeEnd}`,
      ),
    );

    const [previous] = normalizeRows<{ avg_min: number | null }>(
      await ctx.tx.execute(
        sql`SELECT AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 60)::float AS avg_min
              FROM inbox_threads
             WHERE organization_id = ${ctx.orgId}
               AND closed_at IS NOT NULL
               AND created_at >= ${previousStart}
               AND created_at <= ${previousEnd}`,
      ),
    );

    return {
      value: Math.round(current?.avg_min ?? 0),
      previousValue: Math.round(previous?.avg_min ?? 0),
    };
  }

  if (metric === 'threads_pending_approval_count') {
    const rows = await ctx.tx
      .select({ n: count() })
      .from(inboxThreads)
      .where(
        and(
          eq(inboxThreads.organizationId, ctx.orgId),
          eq(inboxThreads.status, 'pending'),
        ),
      );
    return { value: Number(rows[0]?.n ?? 0) };
  }

  throw new Error(`inbox_kpis: scalar metric '${metric}' not supported`);
}

async function loadTimeseries(
  metric: string,
  ctx: DataSourceContext,
): Promise<ReadonlyArray<TimeseriesPoint>> {
  if (metric === 'threads_opened') {
    const rows = await ctx.tx.execute(
      sql`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                  COUNT(*)::int AS n
             FROM inbox_threads
            WHERE organization_id = ${ctx.orgId}
              AND created_at >= ${ctx.rangeStart}
              AND created_at <= ${ctx.rangeEnd}
            GROUP BY day
            ORDER BY day ASC`,
    );
    return normalizeRows<{ day: string; n: number }>(rows).map((r) => ({
      t: r.day,
      v: Number(r.n),
    }));
  }

  if (metric === 'threads_closed') {
    const rows = await ctx.tx.execute(
      sql`SELECT to_char(date_trunc('day', closed_at), 'YYYY-MM-DD') AS day,
                  COUNT(*)::int AS n
             FROM inbox_threads
            WHERE organization_id = ${ctx.orgId}
              AND closed_at IS NOT NULL
              AND closed_at >= ${ctx.rangeStart}
              AND closed_at <= ${ctx.rangeEnd}
            GROUP BY day
            ORDER BY day ASC`,
    );
    return normalizeRows<{ day: string; n: number }>(rows).map((r) => ({
      t: r.day,
      v: Number(r.n),
    }));
  }

  throw new Error(`inbox_kpis: timeseries metric '${metric}' not supported`);
}

async function loadRows(
  opts: { limit: number; filters: Record<string, string | number | boolean> },
  ctx: DataSourceContext,
): Promise<ReadonlyArray<RowEntry>> {
  const limit = Math.min(opts.limit, 25);
  type Row = {
    id: string;
    platform: string;
    subject: string | null;
    createdAt: Date;
    status: string;
  };
  const rows: Row[] = await ctx.tx
    .select({
      id: inboxThreads.id,
      platform: inboxThreads.platform,
      subject: inboxThreads.subject,
      createdAt: inboxThreads.createdAt,
      status: inboxThreads.status,
    })
    .from(inboxThreads)
    .where(
      and(
        eq(inboxThreads.organizationId, ctx.orgId),
        eq(inboxThreads.status, 'pending'),
        isNotNull(inboxThreads.createdAt),
        gte(inboxThreads.createdAt, ctx.rangeStart),
        lte(inboxThreads.createdAt, ctx.rangeEnd),
      ),
    )
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    subject: r.subject ?? '(sin asunto)',
    created_at: r.createdAt.toISOString().slice(0, 10),
    status: r.status,
  }));
}

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

export const inboxKpisSource: DataSource = {
  key: 'inbox_kpis',
  capabilities: {
    scalar: ['avg_response_time_minutes', 'threads_pending_approval_count'],
    timeseries: ['threads_opened', 'threads_closed'],
    rows: true,
  },
  loadScalar,
  loadTimeseries,
  loadRows,
};
