import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { competitors } from './competitors';
import { organizations } from './organizations';

/**
 * Daily competitor rollup (Phase 9 / Commit 34).
 *
 * One row per `(competitor, platform, UTC day)`. Same shape as
 * `ads_spend_daily` (Phase 8) so the cron-driven generators can
 * share read/write patterns.
 *
 * # Share-of-voice semantics (Ajuste C — DOCUMENTED)
 *
 *   SoV = (posts_count of this competitor on this day/platform) /
 *         (this competitor's posts + your-brand's posts on the
 *          same day/platform)
 *
 *   Range: [0, 1].
 *     0.5  → parity (you and the competitor publish equally).
 *     >0.5 → competitor publishes more than your brand.
 *     <0.5 → your brand publishes more than the competitor.
 *
 *   NOT engagement-weighted. A future `engagement_share_of_voice`
 *   column would carry the engagement-weighted ratio if/when the
 *   feature warrants it. C34 measures publication volume only.
 *
 *   NULL-safe at compute time: when (competitor_posts + own_posts)
 *   is zero, SoV stores 0 (NOT NULL) so range queries don't break.
 *
 * `sentiment_score` is the aggregate mean sentiment across all
 * captured mentions of this competitor on this day/platform.
 * Range [-1, 1] (negative through positive).
 */
export const competitorMetricsDaily = pgTable(
  'competitor_metrics_daily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitors.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    day: date('day').notNull(),
    postsCount: integer('posts_count').notNull().default(0),
    engagementTotal: integer('engagement_total').notNull().default(0),
    sentimentScore: numeric('sentiment_score', { precision: 3, scale: 2 })
      .notNull()
      .default('0'),
    shareOfVoice: numeric('share_of_voice', { precision: 4, scale: 3 })
      .notNull()
      .default('0'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqDay: uniqueIndex('competitor_metrics_unique_day').on(
      table.competitorId,
      table.platform,
      table.day,
    ),
    orgDayIdx: index('competitor_metrics_org_day_idx').on(
      table.organizationId,
      table.day,
    ),
    competitorDayIdx: index('competitor_metrics_competitor_day_idx').on(
      table.competitorId,
      table.day,
    ),
    sovRange: check(
      'competitor_metrics_sov_range',
      sql`share_of_voice >= 0 AND share_of_voice <= 1`,
    ),
    sentimentRange: check(
      'competitor_metrics_sentiment_range',
      sql`sentiment_score >= -1 AND sentiment_score <= 1`,
    ),
  }),
);

export type CompetitorMetricDaily =
  typeof competitorMetricsDaily.$inferSelect;
export type NewCompetitorMetricDaily =
  typeof competitorMetricsDaily.$inferInsert;
