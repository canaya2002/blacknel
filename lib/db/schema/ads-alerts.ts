import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  adsAlertKindEnum,
  adsAlertSeverityEnum,
  adsAlertStatusEnum,
} from './_enums';
import { adsAccounts } from './ads-accounts';
import { brands } from './brands';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Ads alert record — Phase 8 / Commit 29.
 *
 * Dedicated table (NOT a reuse of `ai_recommendations`). The
 * Phase-7 `ai_rec_category` enum would have to grow an
 * `'ads_alert'` value to support reuse, which the Phase-8
 * charter rule prohibits. Standalone table keeps Phase 8
 * self-contained and gives Phase 9 room to extend without
 * touching alert history.
 *
 * # Producer
 *
 * `lib/jobs/ads-alerts-scan.ts` runs every 12h
 * (`ADS_ALERTS_TICK_INTERVAL_MS`). For each connected
 * `ads_accounts` row it runs the heuristics in
 * `lib/ads/alerts.ts` (statistical floors — Ajuste 1) and
 * upserts pending rows here. Merge window is **48h** per
 * Ajuste 2 — shorter than the 7d crisis window because ad
 * performance signals are more volatile day-to-day.
 *
 * # Severity escalation
 *
 * On merge, if the new evidence raises severity (e.g. CTR drop
 * deepens from `medium` to `high`), the producer updates the
 * existing row and emits an `ads_alert.escalated` audit.
 *
 * # Decisions
 *
 * `accept` / `dismiss` are terminal. `decided_reason` is
 * captured for `dismiss` and is `null` for `accept`. Re-deciding
 * a terminal row returns `CONFLICT` from the action.
 */
export const adsAlerts = pgTable(
  'ads_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    adsAccountId: uuid('ads_account_id')
      .notNull()
      .references(() => adsAccounts.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    kind: adsAlertKindEnum('kind').notNull(),
    severity: adsAlertSeverityEnum('severity').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    evidence: jsonb('evidence').notNull().default(sql`'{}'::jsonb`),
    status: adsAlertStatusEnum('status').notNull().default('pending'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    decidedReason: text('decided_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgStatusCreatedIdx: index('ads_alerts_org_status_created_idx').on(
      table.organizationId,
      table.status,
      table.createdAt.desc(),
    ),
    accountKindStatusIdx: index('ads_alerts_account_kind_status_idx').on(
      table.adsAccountId,
      table.kind,
      table.status,
    ),
    pendingMergeIdx: index('ads_alerts_pending_merge_idx')
      .on(table.organizationId, table.adsAccountId, table.kind)
      .where(sql`${table.status} = 'pending'`),
  }),
);

export type AdsAlert = typeof adsAlerts.$inferSelect;
export type NewAdsAlert = typeof adsAlerts.$inferInsert;

export type AdsAlertKind = AdsAlert['kind'];
export type AdsAlertSeverity = AdsAlert['severity'];
export type AdsAlertStatus = AdsAlert['status'];
