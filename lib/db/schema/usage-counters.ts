import { bigint, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations';

/**
 * Per-organization counters used by plan-limit checks
 * (`posts_scheduled_this_month`, `social_accounts_connected`, etc.).
 *
 * Counters are scoped to a period — for monthly metrics the period
 * spans calendar months. For point-in-time counts (e.g., total
 * connected accounts) use `period_start = '-infinity'` and
 * `period_end = 'infinity'`.
 */
export const usageCounters = pgTable(
  'usage_counters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgMetricPeriodUnique: uniqueIndex('usage_counters_org_metric_period_unique').on(
      table.organizationId,
      table.metric,
      table.periodStart,
    ),
    orgMetricIdx: index('usage_counters_org_metric_idx').on(table.organizationId, table.metric),
  }),
);

export type UsageCounter = typeof usageCounters.$inferSelect;
export type NewUsageCounter = typeof usageCounters.$inferInsert;
