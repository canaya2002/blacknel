import 'server-only';

import { sql } from 'drizzle-orm';

import type {
  DataSource,
  DataSourceContext,
  ScalarMetric,
  TimeseriesPoint,
} from './index';

/**
 * Phase 10 / Commit 39 — `nps_aggregates` data source.
 *
 * Standard NPS formula: %promoters − %detractors. Score classification
 * is computed by the STORED generated column on `nps_responses`
 * (C32 D-32-6).
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
  if (metric === 'nps_score') {
    const [row] = normalizeRows<{
      promoters: number;
      detractors: number;
      total: number;
    }>(
      await ctx.tx.execute(
        sql`SELECT
              COUNT(*) FILTER (WHERE category = 'promoter')::int  AS promoters,
              COUNT(*) FILTER (WHERE category = 'detractor')::int AS detractors,
              COUNT(*)::int                                       AS total
            FROM nps_responses
            WHERE organization_id = ${ctx.orgId}
              AND created_at >= ${ctx.rangeStart}
              AND created_at <= ${ctx.rangeEnd}`,
      ),
    );
    const total = Number(row?.total ?? 0);
    if (total === 0) return { value: 0 };
    const promoters = Number(row?.promoters ?? 0);
    const detractors = Number(row?.detractors ?? 0);
    const nps = Math.round(((promoters - detractors) / total) * 100);
    return { value: nps };
  }
  throw new Error(`nps_aggregates: scalar metric '${metric}' not supported`);
}

async function loadTimeseries(
  metric: string,
  ctx: DataSourceContext,
): Promise<ReadonlyArray<TimeseriesPoint>> {
  if (metric === 'response_count') {
    const rows = normalizeRows<{ day: string; v: number }>(
      await ctx.tx.execute(
        sql`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                    COUNT(*)::int AS v
               FROM nps_responses
              WHERE organization_id = ${ctx.orgId}
                AND created_at >= ${ctx.rangeStart}
                AND created_at <= ${ctx.rangeEnd}
              GROUP BY day
              ORDER BY day ASC`,
      ),
    );
    return rows.map((r) => ({ t: r.day, v: Number(r.v) }));
  }
  throw new Error(`nps_aggregates: timeseries '${metric}' not supported`);
}

export const npsAggregatesSource: DataSource = {
  key: 'nps_aggregates',
  capabilities: {
    scalar: ['nps_score'],
    timeseries: ['response_count'],
  },
  loadScalar,
  loadTimeseries,
};
