import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { scheduledReportRunStatusEnum } from './_enums';
import { organizations } from './organizations';
import { scheduledReports } from './scheduled-reports';

/**
 * Single dispatch attempt for a `scheduled_reports` row (Phase 9
 * / Commit 34).
 *
 * Lifecycle (matches Phase-6 publish pattern):
 *
 *   queued → running → sent | failed
 *
 * `error_code` + `error_message` are populated only on failure;
 * truncated in the audit metadata so the row stays small.
 */
export const scheduledReportRuns = pgTable(
  'scheduled_report_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    scheduledReportId: uuid('scheduled_report_id')
      .notNull()
      .references(() => scheduledReports.id, { onDelete: 'cascade' }),
    status: scheduledReportRunStatusEnum('status')
      .notNull()
      .default('queued'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    htmlSizeBytes: integer('html_size_bytes'),
    recipientsCount: integer('recipients_count').notNull().default(0),
    errorMessage: text('error_message'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    reportIdx: index('scheduled_report_runs_report_idx').on(
      table.scheduledReportId,
      table.createdAt,
    ),
    orgStatusIdx: index('scheduled_report_runs_org_status_idx').on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
  }),
);

export type ScheduledReportRun = typeof scheduledReportRuns.$inferSelect;
export type NewScheduledReportRun =
  typeof scheduledReportRuns.$inferInsert;
export type ScheduledReportRunStatus = ScheduledReportRun['status'];
