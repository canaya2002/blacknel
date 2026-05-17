import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  inboxSentimentEnum,
  reviewStatusEnum,
} from './_enums';
import { brands } from './brands';
import { connectedAccounts } from './connected-accounts';
import { locations } from './locations';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Public reviews pulled from connected platforms.
 *
 * `sentiment` reuses the same enum that powers `inbox_threads.sentiment`
 * (`inbox_sentiment`). The 4-value vocabulary (positive / neutral /
 * negative / unknown) is the standard IA classifier output Blacknel
 * uses everywhere — sharing the enum prevents drift between modules.
 * IMPACT NOTE: if Reviews ever needs a value Inbox doesn't, both
 * domains would need to grow at once. Document any future ALTER TYPE
 * in this comment so the coupling stays visible.
 *
 * `rating` is constrained to 1..5 by a CHECK constraint in
 * `lib/db/migrations/0006_reviews.sql` — Drizzle has no native
 * CHECK builder, the SQL is the source of truth.
 *
 * The partial unique index on (org, platform, external_review_id)
 * lets us run the connector sync repeatedly without duplicating rows
 * once external_review_id is non-null. Rows ingested manually (BBB
 * CSV, future Avvo scrape) may have NULL external_review_id and stay
 * un-deduplicated — that's intentional.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    connectedAccountId: uuid('connected_account_id').references(() => connectedAccounts.id, {
      onDelete: 'set null',
    }),
    platform: text('platform').notNull(),
    externalReviewId: text('external_review_id'),
    authorName: text('author_name'),
    authorAvatar: text('author_avatar'),
    rating: integer('rating').notNull(),
    body: text('body').notNull().default(''),
    language: text('language'),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
    sentiment: inboxSentimentEnum('sentiment').notNull().default('unknown'),
    status: reviewStatusEnum('status').notNull().default('pending'),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    escalated: boolean('escalated').notNull().default(false),
    tags: jsonb('tags').notNull().default(sql`'[]'::jsonb`),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    /**
     * Phase 10 / Commit 38 — per-platform extension surface.
     *
     * **RENDER-ONLY RULE — STRICT**
     *
     * `platform_specific` jsonb captures per-platform fields that
     * are RENDERED in the UI but never queried/filtered. Examples:
     *   - Yelp `elite_reviewer: boolean`
     *   - TripAdvisor `category_ratings: { food, service, … }`
     *   - BBB `complaint_status / case_id / resolution_summary`
     *   - Avvo `case_type / client_testimonial: boolean`
     *
     * If any field becomes query-relevant (WHERE / GROUP BY /
     * needs an index / compliance constraint), it MUST be
     * promoted to a typed column via dedicated migration.
     *
     * This rule prevents jsonb from becoming the "Drupal sink"
     * of the codebase. Validation per platform lives in
     * `lib/reviews/platform-specific-schemas.ts` (Zod).
     */
    platformSpecific: jsonb('platform_specific'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index('reviews_org_status_idx').on(table.organizationId, table.status),
    orgPostedIdx: index('reviews_org_posted_idx').on(table.organizationId, table.postedAt),
    orgLocationIdx: index('reviews_org_location_idx').on(table.organizationId, table.locationId),
    orgPlatformIdx: index('reviews_org_platform_idx').on(table.organizationId, table.platform),
    orgRatingIdx: index('reviews_org_rating_idx').on(table.organizationId, table.rating),
    orgAssignedIdx: index('reviews_org_assigned_idx').on(
      table.organizationId,
      table.assignedTo,
    ),
    orgPlatformExternalUnique: uniqueIndex('reviews_org_platform_external_unique')
      .on(table.organizationId, table.platform, table.externalReviewId)
      .where(sql`external_review_id IS NOT NULL`),
  }),
);

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
