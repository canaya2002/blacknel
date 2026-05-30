import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { adsAccounts } from './ads-accounts';
import { adsAdSets } from './ads-ad-sets';
import { organizations } from './organizations';

/**
 * Ad — the leaf of the structure hierarchy (Phase 11 / C50). Nullable FK to its
 * parent ad set (same intra-pass ordering reason as `ads_ad_sets.campaign_id`),
 * with `ad_set_external_id` preserving the platform link. Normalized-text
 * `status` + idempotent `(org, ads_account, external_id)` key.
 */
export const adsAds = pgTable(
  'ads_ads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    adsAccountId: uuid('ads_account_id')
      .notNull()
      .references(() => adsAccounts.id, { onDelete: 'cascade' }),
    adSetId: uuid('ad_set_id').references(() => adsAdSets.id, {
      onDelete: 'cascade',
    }),
    externalId: text('external_id').notNull(),
    adSetExternalId: text('ad_set_external_id'),
    name: text('name').notNull(),
    status: text('status').notNull().default('unknown'),
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
      'ads_ads_org_account_external_unique',
    ).on(table.organizationId, table.adsAccountId, table.externalId),
    adSetIdx: index('ads_ads_ad_set_idx')
      .on(table.adSetId)
      .where(sql`${table.adSetId} IS NOT NULL`),
  }),
);

export type AdsAd = typeof adsAds.$inferSelect;
export type NewAdsAd = typeof adsAds.$inferInsert;
