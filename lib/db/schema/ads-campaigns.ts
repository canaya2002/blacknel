import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { adsAccounts } from './ads-accounts';
import { organizations } from './organizations';

/**
 * Ad campaign — the top of the structure hierarchy (Phase 11 / C50).
 *
 * Synced from the platform Marketing API (Meta first) into our own row so the
 * pause/resume/budget actions and the dashboard have a stable handle on each
 * campaign's name + status + budget. `external_id` is the platform's campaign id;
 * `(org, ads_account, external_id)` is the idempotent upsert key.
 *
 * `status` is normalized lowercase text (active|paused|archived|deleted|
 * pending|unknown) — NOT an enum — so later ad platforms with different status
 * vocabularies don't force an `ALTER TYPE`. `raw` keeps the untouched platform
 * payload for forward compat.
 */
export const adsCampaigns = pgTable(
  'ads_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    adsAccountId: uuid('ads_account_id')
      .notNull()
      .references(() => adsAccounts.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('unknown'),
    objective: text('objective'),
    dailyBudgetCents: integer('daily_budget_cents'),
    lifetimeBudgetCents: integer('lifetime_budget_cents'),
    currency: text('currency'),
    raw: jsonb('raw').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgAccountExternalUnique: uniqueIndex(
      'ads_campaigns_org_account_external_unique',
    ).on(table.organizationId, table.adsAccountId, table.externalId),
    accountIdx: index('ads_campaigns_account_idx').on(table.adsAccountId),
  }),
);

export type AdsCampaign = typeof adsCampaigns.$inferSelect;
export type NewAdsCampaign = typeof adsCampaigns.$inferInsert;
