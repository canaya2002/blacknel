import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { adsAccounts } from './ads-accounts';
import { organizations } from './organizations';

/**
 * Denormalized daily spend rollup (Phase 8 / Commit 28).
 *
 * One row per `(organization, ads_account, platform_campaign_id,
 * date, currency)`. The cron sync upserts every 24h against the
 * unique constraint — late-arriving attribution windows
 * (Google/Meta sometimes revise) overwrite cleanly.
 *
 * **Native + USD pair (Ajuste 1).** Each row stores both the
 * native-currency `spend_cents` AND a `spend_usd_cents` value
 * computed at insert via `lib/ads/fx-rates.ts.toUsdCents`. The
 * USD column is FROZEN — re-running the sync after an FX-rate
 * update does NOT recompute historical rows. That's intentional:
 * the dashboard should report "spend you actually paid in USD
 * at that moment", not "spend retroactively converted at today's
 * rate."
 *
 * **`platform_campaign_id`** is the EXTERNAL id from Google Ads
 * / Meta. It does NOT join to our internal `campaigns.id`.
 * Phase-12 polish may add a mapping table so cross-platform
 * campaign joins become possible.
 */
export const adsSpendDaily = pgTable(
  'ads_spend_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    adsAccountId: uuid('ads_account_id')
      .notNull()
      .references(() => adsAccounts.id, { onDelete: 'cascade' }),
    platformCampaignId: text('platform_campaign_id').notNull(),
    date: date('date').notNull(),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    spendCents: integer('spend_cents').notNull().default(0),
    /** USD-converted cents, frozen at-insert. See JSDoc above. */
    spendUsdCents: integer('spend_usd_cents').notNull().default(0),
    /** Attributed conversions for the (campaign, date). Added C50. */
    conversions: integer('conversions').notNull().default(0),
    currency: text('currency').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    upsertUnique: uniqueIndex('ads_spend_daily_unique').on(
      table.organizationId,
      table.adsAccountId,
      table.platformCampaignId,
      table.date,
      table.currency,
    ),
    orgDateIdx: index('ads_spend_daily_org_date_idx').on(
      table.organizationId,
      table.date.desc(),
    ),
    accountDateIdx: index('ads_spend_daily_account_date_idx').on(
      table.adsAccountId,
      table.date.desc(),
    ),
  }),
);

export type AdsSpendDaily = typeof adsSpendDaily.$inferSelect;
export type NewAdsSpendDaily = typeof adsSpendDaily.$inferInsert;
