import 'server-only';

import {
  getDataSource,
  supportsBuckets,
  type DataSourceContext,
} from '../data-sources';
import { distributionChartConfigSchema } from '../validate';
import type { DistributionChartPayload } from '../types';

/**
 * Phase 10 / Commit 39 — Distribution chart widget renderer.
 *
 * Buckets by the configured groupBy key (e.g. `sentiment`). UI side
 * renders as a vanilla SVG horizontal bar chart (D-39-1 a). Buckets
 * are sorted DESC by value at source-load time so the largest bucket
 * appears first.
 */

export async function renderDistributionChart(
  config: unknown,
  baseCtx: DataSourceContext,
): Promise<DistributionChartPayload> {
  const parsed = distributionChartConfigSchema.parse(config);
  const source = getDataSource(parsed.dataSource);
  if (!supportsBuckets(source, parsed.groupBy) || !source.loadBuckets) {
    throw new Error(
      `Data source '${parsed.dataSource}' does not support buckets '${parsed.groupBy}'`,
    );
  }

  const rangeDays = parsed.rangeDays ?? 30;
  const ctx: DataSourceContext = {
    ...baseCtx,
    rangeStart: new Date(
      baseCtx.rangeEnd.getTime() - rangeDays * 86_400_000,
    ),
  };

  const buckets = await source.loadBuckets(parsed.groupBy, ctx);
  return { label: parsed.label, buckets };
}
