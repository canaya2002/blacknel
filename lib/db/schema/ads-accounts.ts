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

import { adsAccountStatusEnum, adsPlatformEnum } from './_enums';
import { brands } from './brands';
import { organizations } from './organizations';

/**
 * Connected ad-account record (Phase 8 / Commit 28).
 *
 * One row per `(organization, platform, external_account_id)`.
 * Re-connecting a previously disconnected account flips `status`
 * back to `'connected'` on the same row — never creates a
 * duplicate.
 *
 * `currency` is the native currency the platform reports spend in
 * (Google Ads / Meta Ads APIs return per-account currency). The
 * cron sync stores both `spend_cents` (native) AND
 * `spend_usd_cents` (computed at-insert via
 * `lib/ads/fx-rates.ts`). Frozen USD values preserve historical
 * accuracy when FX rates update.
 *
 * `brand_id` is OPTIONAL — Phase 8 lets an org connect an ad
 * account without tying it to a specific brand (multi-brand
 * accounts are common). Phase 9 polish may add a per-campaign
 * brand mapping.
 */
export const adsAccounts = pgTable(
  'ads_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    platform: adsPlatformEnum('platform').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    accountName: text('account_name'),
    currency: text('currency').notNull().default('USD'),
    status: adsAccountStatusEnum('status').notNull().default('connected'),
    connectedAt: timestamp('connected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgPlatformExternalUnique: uniqueIndex(
      'ads_accounts_org_platform_external_unique',
    ).on(table.organizationId, table.platform, table.externalAccountId),
    orgStatusIdx: index('ads_accounts_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
    brandIdx: index('ads_accounts_brand_idx')
      .on(table.brandId)
      .where(sql`${table.brandId} IS NOT NULL`),
  }),
);

export type AdsAccount = typeof adsAccounts.$inferSelect;
export type NewAdsAccount = typeof adsAccounts.$inferInsert;
