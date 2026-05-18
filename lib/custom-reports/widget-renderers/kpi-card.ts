import 'server-only';

import {
  getDataSource,
  supportsScalar,
  type DataSourceContext,
} from '../data-sources';
import { kpiCardConfigSchema } from '../validate';
import type { KpiCardPayload } from '../types';

/**
 * Phase 10 / Commit 39 — KPI card widget renderer.
 *
 * Pure data → payload mapping. The UI side (`widget-renderer.tsx`)
 * decides typography + delta arrow. Delta `percent` is null when
 * the previous-period denominator was zero (avoid Infinity).
 */

export async function renderKpiCard(
  config: unknown,
  ctx: DataSourceContext,
): Promise<KpiCardPayload> {
  const parsed = kpiCardConfigSchema.parse(config);
  const source = getDataSource(parsed.dataSource);
  if (!supportsScalar(source, parsed.metric) || !source.loadScalar) {
    throw new Error(
      `Data source '${parsed.dataSource}' does not support scalar metric '${parsed.metric}'`,
    );
  }

  const scalar = await source.loadScalar(parsed.metric, ctx);

  let delta: KpiCardPayload['delta'];
  if (
    parsed.compareToPrevious &&
    typeof scalar.previousValue === 'number'
  ) {
    const absolute = scalar.value - scalar.previousValue;
    const percent =
      scalar.previousValue === 0
        ? null
        : Math.round((absolute / scalar.previousValue) * 10000) / 100;
    delta = { absolute, percent };
  }

  return {
    label: parsed.label,
    value: scalar.value,
    format: parsed.format,
    delta,
  };
}
