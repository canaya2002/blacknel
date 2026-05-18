import 'server-only';

import { and, count, eq, gte, lte } from 'drizzle-orm';

import { aiRecommendations } from '@/lib/db/schema';

import type {
  DataSource,
  DataSourceContext,
  ScalarMetric,
} from './index';

/**
 * Phase 10 / Commit 39 — `crisis_aggregates` data source.
 *
 * NEW source added for C39 template "Executive Dashboard" (Ajuste 1).
 * Reads `ai_recommendations` where `category = 'crisis'`. Pending
 * count + total count in window.
 *
 * Phase 11 evaluation: this source today wraps recommendations table.
 * If we ever split crisis events into a dedicated table, this source
 * swaps implementation; capabilities + interface stay.
 */

async function loadScalar(
  metric: string,
  ctx: DataSourceContext,
): Promise<ScalarMetric> {
  if (metric === 'pending_count') {
    const rows = await ctx.tx
      .select({ n: count() })
      .from(aiRecommendations)
      .where(
        and(
          eq(aiRecommendations.organizationId, ctx.orgId),
          eq(aiRecommendations.category, 'crisis'),
          eq(aiRecommendations.status, 'pending'),
        ),
      );
    return { value: Number(rows[0]?.n ?? 0) };
  }

  if (metric === 'total_in_range') {
    const rows = await ctx.tx
      .select({ n: count() })
      .from(aiRecommendations)
      .where(
        and(
          eq(aiRecommendations.organizationId, ctx.orgId),
          eq(aiRecommendations.category, 'crisis'),
          gte(aiRecommendations.createdAt, ctx.rangeStart),
          lte(aiRecommendations.createdAt, ctx.rangeEnd),
        ),
      );
    return { value: Number(rows[0]?.n ?? 0) };
  }

  throw new Error(`crisis_aggregates: scalar '${metric}' not supported`);
}

export const crisisAggregatesSource: DataSource = {
  key: 'crisis_aggregates',
  capabilities: {
    scalar: ['pending_count', 'total_in_range'],
  },
  loadScalar,
};
