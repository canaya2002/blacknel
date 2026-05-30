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
import { adsCampaigns } from './ads-campaigns';
import { organizations } from './organizations';

/**
 * Ad set (Meta) / ad group (Google) — the middle of the structure hierarchy
 * (Phase 11 / C50). FK to its parent campaign is nullable: structure sync may
 * land an ad set before its campaign in the same pass, and `campaign_external_id`
 * preserves the platform link regardless. Same normalized-text `status` +
 * idempotent `(org, ads_account, external_id)` key as `ads_campaigns`.
 */
export const adsAdSets = pgTable(
  'ads_ad_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    adsAccountId: uuid('ads_account_id')
      .notNull()
      .references(() => adsAccounts.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => adsCampaigns.id, {
      onDelete: 'cascade',
    }),
    externalId: text('external_id').notNull(),
    campaignExternalId: text('campaign_external_id'),
    name: text('name').notNull(),
    status: text('status').notNull().default('unknown'),
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
      'ads_ad_sets_org_account_external_unique',
    ).on(table.organizationId, table.adsAccountId, table.externalId),
    campaignIdx: index('ads_ad_sets_campaign_idx')
      .on(table.campaignId)
      .where(sql`${table.campaignId} IS NOT NULL`),
  }),
);

export type AdsAdSet = typeof adsAdSets.$inferSelect;
export type NewAdsAdSet = typeof adsAdSets.$inferInsert;
