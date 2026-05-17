import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { competitorStatusEnum } from './_enums';
import { brands } from './brands';
import { organizations } from './organizations';

/**
 * A watched competitor account (Phase 9 / Commit 34).
 *
 * `handles` is a `jsonb` of `{ platform: handle }` — Instagram and
 * X often use different identifiers (`@brand_inc` vs `@brandinc`),
 * so a per-platform map is more accurate than a single column.
 *
 * `platforms` (text[]) is the canonical list of platforms watched.
 * Must be a subset of the keys in `handles` — enforced at validation
 * layer, not DB (would require a complex CHECK against jsonb).
 *
 * Unique on `(org, brand, name)` — managers may track the same
 * competitor under multiple brands but not duplicate within a brand.
 */
export const competitors = pgTable(
  'competitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    handles: jsonb('handles').notNull().default(sql`'{}'::jsonb`),
    platforms: text('platforms').array().notNull(),
    status: competitorStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    orgStatusIdx: index('competitors_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
    orgActiveIdx: index('competitors_org_active_idx')
      .on(table.organizationId)
      .where(sql`status = 'active'`),
    orgBrandNameUnique: uniqueIndex('competitors_unique_per_brand').on(
      table.organizationId,
      table.brandId,
      table.name,
    ),
    platformsNonempty: check(
      'competitors_platforms_nonempty',
      sql`cardinality(platforms) >= 1`,
    ),
  }),
);

export type Competitor = typeof competitors.$inferSelect;
export type NewCompetitor = typeof competitors.$inferInsert;
export type CompetitorStatus = Competitor['status'];
