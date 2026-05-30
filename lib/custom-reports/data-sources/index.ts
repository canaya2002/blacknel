import 'server-only';

import type { AnyPgTx } from '@/lib/db/client';

import type { CustomReportDataSource } from '../types';

import { adsSpendSource } from './ads-spend';
import { competitorsAggregatesSource } from './competitors-aggregates';
import { crisisAggregatesSource } from './crisis-aggregates';
import { inboxKpisSource } from './inbox-kpis';
import { listeningAggregatesSource } from './listening-aggregates';
import { npsAggregatesSource } from './nps-aggregates';
import { postInsightsSource } from './post-insights';
import { postsMetricsSource } from './posts-metrics';
import { reviewsAggregatesSource } from './reviews-aggregates';

/**
 * Phase 10 / Commit 39 — data source catalog + dispatcher.
 *
 * # D-39-9 (b) — kind narrows source FAMILY
 *
 * Each `WidgetKind` maps to a set of data shapes:
 *
 *   kpi_card           → scalar
 *   sparkline          → timeseries
 *   distribution_chart → buckets
 *   table              → rows
 *   text_block         → none (no data source)
 *
 * A widget config picks both (a) the data source and (b) the metric
 * / groupBy within that source. Validation step: the dispatcher
 * checks the source declared the requested shape — e.g. asking
 * `posts_metrics` for buckets on `'sentiment'` would fail if the
 * source's `capabilities.buckets` doesn't list `'sentiment'`.
 *
 * # Phase 11 swap
 *
 * In Phase 11 these sources transition from local aggregations to
 * the canonical aggregator infrastructure (`lib/reports/*`) +
 * external connector data. The interface here stays stable;
 * implementations swap.
 */

export interface DataSourceContext {
  readonly tx: AnyPgTx;
  readonly orgId: string;
  readonly userId: string;
  readonly rangeStart: Date;
  readonly rangeEnd: Date;
  readonly brandId: string | null;
}

export interface ScalarMetric {
  readonly value: number;
  readonly previousValue?: number;
}

export interface TimeseriesPoint {
  readonly t: string; // ISO `YYYY-MM-DD`
  readonly v: number;
}

export interface BucketEntry {
  readonly key: string;
  readonly value: number;
}

export type RowEntry = Record<string, string | number | null>;

export interface DataSourceCapabilities {
  readonly scalar?: ReadonlyArray<string>;
  readonly timeseries?: ReadonlyArray<string>;
  readonly buckets?: ReadonlyArray<string>;
  readonly rows?: boolean;
}

export interface DataSource {
  readonly key: CustomReportDataSource;
  readonly capabilities: DataSourceCapabilities;
  readonly loadScalar?: (
    metric: string,
    ctx: DataSourceContext,
  ) => Promise<ScalarMetric>;
  readonly loadTimeseries?: (
    metric: string,
    ctx: DataSourceContext,
  ) => Promise<ReadonlyArray<TimeseriesPoint>>;
  readonly loadBuckets?: (
    groupBy: string,
    ctx: DataSourceContext,
  ) => Promise<ReadonlyArray<BucketEntry>>;
  readonly loadRows?: (
    opts: { readonly limit: number; readonly filters: Record<string, string | number | boolean> },
    ctx: DataSourceContext,
  ) => Promise<ReadonlyArray<RowEntry>>;
}

const REGISTRY: Record<CustomReportDataSource, DataSource> = {
  inbox_kpis: inboxKpisSource,
  reviews_aggregates: reviewsAggregatesSource,
  posts_metrics: postsMetricsSource,
  post_insights: postInsightsSource,
  ads_spend: adsSpendSource,
  nps_aggregates: npsAggregatesSource,
  listening_aggregates: listeningAggregatesSource,
  competitors_aggregates: competitorsAggregatesSource,
  crisis_aggregates: crisisAggregatesSource,
};

export function getDataSource(key: CustomReportDataSource): DataSource {
  const source = REGISTRY[key];
  if (!source) {
    throw new Error(`Unknown custom-reports data source: ${key}`);
  }
  return source;
}

export function listDataSources(): ReadonlyArray<DataSource> {
  return Object.values(REGISTRY);
}

export function supportsScalar(
  source: DataSource,
  metric: string,
): boolean {
  return (source.capabilities.scalar ?? []).includes(metric);
}

export function supportsTimeseries(
  source: DataSource,
  metric: string,
): boolean {
  return (source.capabilities.timeseries ?? []).includes(metric);
}

export function supportsBuckets(
  source: DataSource,
  groupBy: string,
): boolean {
  return (source.capabilities.buckets ?? []).includes(groupBy);
}

export function supportsRows(source: DataSource): boolean {
  return source.capabilities.rows === true;
}
