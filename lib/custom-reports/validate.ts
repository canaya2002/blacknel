import { z } from 'zod';

import type { CustomReportDataSource, CustomReportWidgetKind } from './types';

/**
 * Phase 10 / Commit 39 — Zod schemas for custom_reports +
 * custom_report_widgets Server Action boundaries.
 *
 * # Per-widget-kind config schemas
 *
 * One schema per `CustomReportWidgetKind`. Strict mode rejects
 * unknown fields. The dispatcher `validateWidgetConfig(kind,
 * payload)` picks the right schema.
 *
 * # Render-only rule (mirrors C38 platform_specific)
 *
 * These configs are visualization-only. None of these fields leak
 * into WHERE / ORDER BY / GROUP BY clauses. If a field becomes
 * query-relevant, promote to typed column via dedicated migration.
 */

const DATA_SOURCE_CODES = [
  'inbox_kpis',
  'reviews_aggregates',
  'posts_metrics',
  'ads_spend',
  'nps_aggregates',
  'listening_aggregates',
  'crisis_aggregates',
] as const satisfies ReadonlyArray<CustomReportDataSource>;

const DATA_SOURCE = z.enum(DATA_SOURCE_CODES);

const FORMAT_SCALAR = z.enum([
  'number',
  'percent',
  'currency_usd',
  'duration_minutes',
  'duration_hours',
]);
const FORMAT_COLUMN = z.enum([
  'number',
  'percent',
  'currency_usd',
  'date',
  'text',
]);

export const kpiCardConfigSchema = z
  .object({
    dataSource: DATA_SOURCE,
    metric: z.string().min(1).max(60),
    label: z.string().min(1).max(80),
    compareToPrevious: z.boolean().optional(),
    format: FORMAT_SCALAR.optional(),
  })
  .strict();

export const tableConfigSchema = z
  .object({
    dataSource: DATA_SOURCE,
    columns: z
      .array(
        z
          .object({
            key: z.string().min(1).max(40),
            label: z.string().min(1).max(60),
            format: FORMAT_COLUMN.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    limit: z.number().int().min(1).max(50).optional(),
    filters: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  })
  .strict();

export const sparklineConfigSchema = z
  .object({
    dataSource: DATA_SOURCE,
    metric: z.string().min(1).max(60),
    label: z.string().min(1).max(80),
    rangeDays: z.number().int().min(7).max(365).optional(),
    compareToPrevious: z.boolean().optional(),
  })
  .strict();

export const distributionChartConfigSchema = z
  .object({
    dataSource: DATA_SOURCE,
    groupBy: z.string().min(1).max(40),
    label: z.string().min(1).max(80),
    rangeDays: z.number().int().min(7).max(365).optional(),
  })
  .strict();

export const textBlockConfigSchema = z
  .object({
    markdown: z.string().min(1).max(4000),
    heading: z.string().max(120).optional(),
  })
  .strict();

/**
 * Dispatcher — picks the schema by widget kind. Throws ZodError on
 * mismatch.
 */
export function validateWidgetConfig(
  kind: CustomReportWidgetKind,
  payload: unknown,
): unknown {
  switch (kind) {
    case 'kpi_card':
      return kpiCardConfigSchema.parse(payload);
    case 'table':
      return tableConfigSchema.parse(payload);
    case 'sparkline':
      return sparklineConfigSchema.parse(payload);
    case 'distribution_chart':
      return distributionChartConfigSchema.parse(payload);
    case 'text_block':
      return textBlockConfigSchema.parse(payload);
  }
}

// ---------------------------------------------------------------------------
// Server Action input schemas
// ---------------------------------------------------------------------------

const SHARE_SCOPE = z.enum(['private', 'org_visible', 'specific_users']);

export const createCustomReportSchema = z
  .object({
    name: z.string().min(1).max(120).transform((s) => s.trim()),
    description: z.string().max(1000).nullable().optional(),
    brandId: z.string().uuid().nullable().optional(),
    templateId: z
      .enum(['marketing_performance', 'customer_service_overview', 'executive_dashboard'])
      .nullable()
      .optional(),
  })
  .strict();

export type CreateCustomReportInput = z.infer<typeof createCustomReportSchema>;

export const updateCustomReportSchema = z
  .object({
    reportId: z.string().uuid(),
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
    brandId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const addWidgetSchema = z
  .object({
    reportId: z.string().uuid(),
    kind: z.enum([
      'kpi_card',
      'table',
      'sparkline',
      'distribution_chart',
      'text_block',
    ]),
    positionRow: z.number().int().min(0).max(50),
    positionCol: z.number().int().min(0).max(11),
    width: z.number().int().min(1).max(12).optional(),
    height: z.number().int().min(1).max(8).optional(),
    config: z.unknown(), // dispatched via validateWidgetConfig in the action
  })
  .strict();

export const removeWidgetSchema = z
  .object({
    widgetId: z.string().uuid(),
  })
  .strict();

export const updateWidgetConfigSchema = z
  .object({
    widgetId: z.string().uuid(),
    config: z.unknown(), // dispatched via validateWidgetConfig in the action
  })
  .strict();

export const moveWidgetSchema = z
  .object({
    widgetId: z.string().uuid(),
    positionRow: z.number().int().min(0).max(50),
    positionCol: z.number().int().min(0).max(11),
    width: z.number().int().min(1).max(12).optional(),
    height: z.number().int().min(1).max(8).optional(),
  })
  .strict();

export const publishCustomReportSchema = z
  .object({
    reportId: z.string().uuid(),
  })
  .strict();

export const archiveCustomReportSchema = z
  .object({
    reportId: z.string().uuid(),
  })
  .strict();

export const shareCustomReportSchema = z
  .object({
    reportId: z.string().uuid(),
    shareScope: SHARE_SCOPE,
    sharedWith: z.array(z.string().uuid()).max(50).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.shareScope !== 'specific_users' ||
      (v.sharedWith && v.sharedWith.length > 0),
    {
      message: 'specific_users requires at least one user id in sharedWith',
      path: ['sharedWith'],
    },
  );

export const exportCustomReportHtmlSchema = z
  .object({
    reportId: z.string().uuid(),
  })
  .strict();
