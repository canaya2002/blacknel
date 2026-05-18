import 'server-only';

import {
  getDataSource,
  supportsTimeseries,
  type DataSourceContext,
} from '../data-sources';
import { sparklineConfigSchema } from '../validate';
import type { SparklinePayload } from '../types';

/**
 * Phase 10 / Commit 39 — Sparkline widget renderer.
 *
 * Returns a flat array of `{t, v}` points. The UI renders these as
 * vanilla SVG (D-39-1 a — no recharts). Delta uses last vs first
 * point; null percent when first point is zero.
 */

export async function renderSparkline(
  config: unknown,
  baseCtx: DataSourceContext,
): Promise<SparklinePayload> {
  const parsed = sparklineConfigSchema.parse(config);
  const source = getDataSource(parsed.dataSource);
  if (!supportsTimeseries(source, parsed.metric) || !source.loadTimeseries) {
    throw new Error(
      `Data source '${parsed.dataSource}' does not support timeseries '${parsed.metric}'`,
    );
  }

  // Sparkline-specific window: rangeDays trumps the report-level
  // window (so a "last 90d" sparkline still shows 90 days inside a
  // 30-day report).
  const rangeDays = parsed.rangeDays ?? 30;
  const ctx: DataSourceContext = {
    ...baseCtx,
    rangeStart: new Date(
      baseCtx.rangeEnd.getTime() - rangeDays * 86_400_000,
    ),
  };

  const points = await source.loadTimeseries(parsed.metric, ctx);

  let delta: SparklinePayload['delta'];
  if (parsed.compareToPrevious && points.length >= 2) {
    const first = points[0]!.v;
    const last = points[points.length - 1]!.v;
    const absolute = last - first;
    const percent =
      first === 0 ? null : Math.round((absolute / first) * 10000) / 100;
    delta = { absolute, percent };
  }

  return {
    label: parsed.label,
    points,
    delta,
  };
}
