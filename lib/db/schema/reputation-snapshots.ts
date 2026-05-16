import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { locations } from './locations';
import { organizations } from './organizations';

/**
 * Daily roll-up of reputation per (location, platform). The job that
 * fills this table is intentionally write-idempotent: re-running for
 * a date that already has a snapshot performs `ON CONFLICT ... DO
 * UPDATE` on the unique key — so the nightly cron can backfill or
 * recompute without producing duplicates.
 *
 * `rating_avg` is `numeric(3,2)` so we keep the rounded display value
 * (e.g. `4.32`) without floating-point drift across days.
 * `response_rate` is `numeric(5,2)` to fit 0.00–100.00.
 *
 * `sentiment_breakdown` is jsonb expecting `{ positive, neutral,
 * negative, unknown }` proportions summing to 1.0 — UI parses it
 * defensively (NULL keys → 0).
 */
export const reputationSnapshots = pgTable(
  'reputation_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    date: date('date').notNull(),
    ratingAvg: numeric('rating_avg', { precision: 3, scale: 2 }),
    reviewCount: integer('review_count').notNull().default(0),
    responseRate: numeric('response_rate', { precision: 5, scale: 2 }),
    sentimentBreakdown: jsonb('sentiment_breakdown').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgDateIdx: index('reputation_snapshots_org_date_idx').on(table.organizationId, table.date),
    orgLocationPlatformDateUnique: uniqueIndex(
      'reputation_snapshots_org_location_platform_date_unique',
    ).on(table.organizationId, table.locationId, table.platform, table.date),
  }),
);

export type ReputationSnapshot = typeof reputationSnapshots.$inferSelect;
export type NewReputationSnapshot = typeof reputationSnapshots.$inferInsert;
