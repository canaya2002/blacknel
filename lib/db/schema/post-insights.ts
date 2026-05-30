import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations';
import { postTargets } from './post-targets';

/**
 * Per-post engagement insights (Phase 11 / C52). The analytics pillar was
 * publishing without measuring — this is the missing data. One row per
 * `post_target` (per published post per connected account), upserted each sync
 * to the latest snapshot. Reach/impressions/likes/comments/shares come from the
 * platform insights APIs (Meta first; others mock → follow-up). `posted_at` is
 * the parent target's publish time, denormalized so analytics buckets engagement
 * by post date without a join. Org-scoped RLS.
 */
export const postInsights = pgTable(
  'post_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    postTargetId: uuid('post_target_id')
      .notNull()
      .references(() => postTargets.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    externalPostId: text('external_post_id').notNull(),
    reach: integer('reach').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    likes: integer('likes').notNull().default(0),
    comments: integer('comments').notNull().default(0),
    shares: integer('shares').notNull().default(0),
    engagement: integer('engagement').notNull().default(0),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgTargetUnique: uniqueIndex('post_insights_org_target_unique').on(
      table.organizationId,
      table.postTargetId,
    ),
    orgPlatformPostedIdx: index('post_insights_org_platform_posted_idx').on(
      table.organizationId,
      table.platform,
      table.postedAt.desc(),
    ),
  }),
);

export type PostInsight = typeof postInsights.$inferSelect;
export type NewPostInsight = typeof postInsights.$inferInsert;
