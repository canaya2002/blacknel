import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { customReportWidgetKindEnum } from './_enums';
import { customReports } from './custom-reports';

/**
 * Widget instances inside a custom report (Phase 10 / Commit 39).
 *
 * # Single source of truth for positions
 *
 * `position_row`, `position_col`, `width`, `height` live HERE. The
 * parent `custom_reports.layout` jsonb does NOT duplicate widget
 * positions — see D-39-6 (b) in the migration header.
 *
 * # Grid constraints
 *
 * Standard 12-column grid. Width capped at 12 (can span full row).
 * Height capped at 8 (sanity bound). CHECK constraints catch
 * out-of-grid placement at DB layer; `lib/custom-reports/layout-validate.ts`
 * adds overlap detection at app layer (publish only — D-39-7 a).
 *
 * # `config` jsonb
 *
 * Per-kind configuration: data source selection, filters, display
 * options. Validated by Zod schemas in
 * `lib/custom-reports/validate.ts` — one schema per
 * `custom_report_widget_kind` value. Strict mode rejects unknown
 * fields.
 *
 * Render-only treatment: `config` is read by widget renderers,
 * never queried. No index, no WHERE.
 */
export const customReportWidgets = pgTable(
  'custom_report_widgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customReportId: uuid('custom_report_id')
      .notNull()
      .references(() => customReports.id, { onDelete: 'cascade' }),
    kind: customReportWidgetKindEnum('kind').notNull(),
    positionRow: integer('position_row').notNull(),
    positionCol: integer('position_col').notNull(),
    width: integer('width').notNull().default(1),
    height: integer('height').notNull().default(1),
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    reportIdx: index('custom_report_widgets_report_idx').on(table.customReportId),
    reportOrderIdx: index('custom_report_widgets_report_order_idx').on(
      table.customReportId,
      table.positionRow,
      table.positionCol,
    ),
    positionRowNonneg: check(
      'widget_position_row_nonneg',
      sql`position_row >= 0`,
    ),
    positionColInGrid: check(
      'widget_position_col_in_grid',
      sql`position_col >= 0 AND position_col < 12`,
    ),
    widthPositive: check(
      'widget_width_positive',
      sql`width >= 1 AND width <= 12`,
    ),
    heightPositive: check(
      'widget_height_positive',
      sql`height >= 1 AND height <= 8`,
    ),
    positionFitsGrid: check(
      'widget_position_fits_grid',
      sql`position_col + width <= 12`,
    ),
  }),
);

export type CustomReportWidget = typeof customReportWidgets.$inferSelect;
export type NewCustomReportWidget = typeof customReportWidgets.$inferInsert;
export type CustomReportWidgetKind = CustomReportWidget['kind'];
