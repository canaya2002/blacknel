import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { reviewResponseStatusEnum } from './_enums';
import { organizations } from './organizations';
import { reviews } from './reviews';
import { users } from './users';

/**
 * Outbound response to a public review.
 *
 * `organization_id` is **denormalized** from the parent review. A
 * BEFORE INSERT trigger (`review_responses_set_org_id` in
 * `0006_reviews.sql`) stamps it from `reviews.organization_id` when
 * callers leave it NULL. Server Actions always pass it explicitly
 * from the session — the trigger is defense in depth for seeds /
 * dev tools / future cron jobs. Same pattern as `inbox_messages`
 * (Commit 7).
 *
 * `compliance_score` is reserved for Phase 7's real IA compliance
 * pass. Phase 5 leaves it NULL on every row.
 *
 * `idempotency_key` carries the outbound send key for retries; the
 * partial unique index `(review_id, idempotency_key) WHERE NOT NULL`
 * keeps inbound-only / draft rows un-deduplicated.
 */
export const reviewResponses = pgTable(
  'review_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    draftText: text('draft_text'),
    finalText: text('final_text'),
    status: reviewResponseStatusEnum('status').notNull().default('draft'),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    /** 0..100 — populated by Phase 7's real IA pass. NULL in Phase 5. */
    complianceScore: integer('compliance_score'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    externalResponseId: text('external_response_id'),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reviewIdx: index('review_responses_review_idx').on(table.reviewId),
    orgStatusIdx: index('review_responses_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
    idempotencyUnique: uniqueIndex('review_responses_review_idempotency_unique')
      .on(table.reviewId, table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
  }),
);

export type ReviewResponse = typeof reviewResponses.$inferSelect;
export type NewReviewResponse = typeof reviewResponses.$inferInsert;
