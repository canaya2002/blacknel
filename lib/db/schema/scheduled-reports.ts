import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  scheduledReportKindEnum,
  scheduledReportStatusEnum,
} from './_enums';
import { brands } from './brands';
import { organizations } from './organizations';

/**
 * Recurring report dispatch configuration (Phase 9 / Commit 34).
 *
 * Each row is a "send the org's overview report to these
 * recipients on this cadence". The cron tick reads
 * `status='active' AND next_run_at <= now`, generates the HTML
 * via `lib/scheduled-reports/report-builder.ts`, pushes to the
 * dev outbox, and recomputes `next_run_at` respecting the org's
 * timezone (R-34-1).
 *
 * `kind` discriminates UI affordance; `schedule_expr` is the
 * source of truth the cron parses. For `weekly` we accept
 * `"<day-of-week> HH:MM"` (e.g. `"mon 09:00"`); for `monthly`
 * `"<day-of-month> HH:MM"` (e.g. `"1 09:00"`); for `custom` a
 * regular cron-5 expression.
 *
 * `recipients text[]` is a flat list of email addresses. Phase
 * 11 may add resolved user-ids; today the dev outbox is
 * email-only.
 */
export const scheduledReports = pgTable(
  'scheduled_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    kind: scheduledReportKindEnum('kind').notNull(),
    scheduleExpr: text('schedule_expr').notNull(),
    recipients: text('recipients').array().notNull(),
    status: scheduledReportStatusEnum('status').notNull().default('active'),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index('scheduled_reports_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
    dueIdx: index('scheduled_reports_due_idx')
      .on(table.nextRunAt)
      .where(sql`status = 'active'`),
    recipientsNonempty: check(
      'scheduled_reports_recipients_nonempty',
      sql`cardinality(recipients) >= 1`,
    ),
  }),
);

export type ScheduledReport = typeof scheduledReports.$inferSelect;
export type NewScheduledReport = typeof scheduledReports.$inferInsert;
export type ScheduledReportKind = ScheduledReport['kind'];
export type ScheduledReportStatus = ScheduledReport['status'];
