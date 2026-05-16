import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { campaignGoalEnum, campaignStatusEnum } from './_enums';
import { brands } from './brands';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Marketing campaign — a logical grouping for posts published in
 * service of one objective (a launch, a promotion, an ongoing
 * "always-on" stream). Posts reference a campaign by FK and the
 * reports module (Phase 8) aggregates against this dimension.
 *
 * `goal` is a taxonomy, not an enforcement — a campaign with goal
 * `'awareness'` can hold any kind of post. The taxonomy drives
 * filters and report categorization.
 *
 * `budget_cents` is optional. Used by Phase 10 (Ads Intelligence)
 * to correlate organic + paid spend; Phase 6 just stores it.
 *
 * Lifecycle transitions are documented on `campaignStatusEnum` in
 * `_enums.ts`.
 */
export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    goal: campaignGoalEnum('goal').notNull().default('evergreen'),
    status: campaignStatusEnum('status').notNull().default('draft'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Optional planned budget in the org's billing currency, in
     * cents. NULL means "not specified" — distinct from 0 ("no
     * budget allocated").
     */
    budgetCents: integer('budget_cents'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index('campaigns_org_status_idx').on(table.organizationId, table.status),
    orgBrandIdx: index('campaigns_org_brand_idx').on(table.organizationId, table.brandId),
  }),
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
