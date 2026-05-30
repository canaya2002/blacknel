/**
 * Phase 10 / Commit 39 — typed widget config union.
 *
 * Each widget kind declares its own config shape. Stored as jsonb
 * in `custom_report_widgets.config`; validated via the Zod schemas
 * in `lib/custom-reports/validate.ts`.
 *
 * # Kind ↔ data-source coupling (D-39-9 b)
 *
 * Widget kind narrows the SOURCE FAMILY (kpi_card → scalar-emitting
 * sources; table → row-emitting sources; sparkline →
 * timeseries-emitting; distribution_chart → category-bucket
 * emitting; text_block → no data source). The `dataSource` field
 * inside config picks the specific source from that family.
 *
 * # Render-only rule
 *
 * `config` jsonb is read by widget renderers, never queried. No
 * WHERE clause, no GROUP BY. If a config field becomes query-
 * relevant, promote to typed column via dedicated migration.
 */

export type CustomReportWidgetKind =
  | 'kpi_card'
  | 'table'
  | 'sparkline'
  | 'distribution_chart'
  | 'text_block';

/**
 * Data source catalog — each entry is the key the dispatcher in
 * `lib/custom-reports/data-sources/index.ts` recognizes. Adding a
 * new source requires:
 *
 *   1. Extend this union.
 *   2. Add a new file under `lib/custom-reports/data-sources/`.
 *   3. Register in the dispatcher.
 *   4. Update the templates catalog if applicable.
 */
export type CustomReportDataSource =
  | 'inbox_kpis'
  | 'reviews_aggregates'
  | 'posts_metrics'
  | 'post_insights'
  | 'ads_spend'
  | 'nps_aggregates'
  | 'listening_aggregates'
  | 'crisis_aggregates';

export interface KpiCardConfig {
  readonly dataSource: CustomReportDataSource;
  readonly metric: string; // e.g. 'avg_response_time_minutes'
  readonly label: string;
  readonly compareToPrevious?: boolean;
  readonly format?: 'number' | 'percent' | 'currency_usd' | 'duration_minutes' | 'duration_hours';
}

export interface TableConfig {
  readonly dataSource: CustomReportDataSource;
  readonly columns: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly format?: 'number' | 'percent' | 'currency_usd' | 'date' | 'text';
  }>;
  readonly limit?: number; // default 10
  readonly filters?: Record<string, string | number | boolean>;
}

export interface SparklineConfig {
  readonly dataSource: CustomReportDataSource;
  readonly metric: string;
  readonly label: string;
  readonly rangeDays?: number; // default 30
  readonly compareToPrevious?: boolean;
}

export interface DistributionChartConfig {
  readonly dataSource: CustomReportDataSource;
  readonly groupBy: string; // e.g. 'sentiment'
  readonly label: string;
  readonly rangeDays?: number; // default 30
}

export interface TextBlockConfig {
  readonly markdown: string; // sanitized at render
  readonly heading?: string;
}

export type WidgetConfig =
  | { kind: 'kpi_card'; config: KpiCardConfig }
  | { kind: 'table'; config: TableConfig }
  | { kind: 'sparkline'; config: SparklineConfig }
  | { kind: 'distribution_chart'; config: DistributionChartConfig }
  | { kind: 'text_block'; config: TextBlockConfig };

/**
 * Layout jsonb metadata — grid-level options only (D-39-6 b).
 * Widget positions live on `custom_report_widgets` rows. Render-only.
 */
export interface CustomReportLayout {
  readonly theme?: 'light' | 'dark' | 'auto';
  readonly gapSize?: 'compact' | 'normal' | 'spacious';
  readonly headerCollapsed?: boolean;
  readonly columns?: number; // future: support 6-col / 24-col grids; default 12
}

/**
 * Renderer output. Composite of all 5 kinds.
 */
export type WidgetRenderedPayload =
  | { kind: 'kpi_card'; payload: KpiCardPayload }
  | { kind: 'table'; payload: TablePayload }
  | { kind: 'sparkline'; payload: SparklinePayload }
  | { kind: 'distribution_chart'; payload: DistributionChartPayload }
  | { kind: 'text_block'; payload: TextBlockPayload };

export interface KpiCardPayload {
  readonly label: string;
  readonly value: number | string;
  readonly format: KpiCardConfig['format'];
  readonly delta?: { readonly absolute: number; readonly percent: number | null };
}

export interface TablePayload {
  readonly columns: ReadonlyArray<{ readonly key: string; readonly label: string; readonly format?: string }>;
  readonly rows: ReadonlyArray<Record<string, string | number | null>>;
}

export interface SparklinePayload {
  readonly label: string;
  readonly points: ReadonlyArray<{ readonly t: string; readonly v: number }>;
  readonly delta?: { readonly absolute: number; readonly percent: number | null };
}

export interface DistributionChartPayload {
  readonly label: string;
  readonly buckets: ReadonlyArray<{ readonly key: string; readonly value: number }>;
}

export interface TextBlockPayload {
  readonly safeHtml: string;
  readonly heading?: string;
}
