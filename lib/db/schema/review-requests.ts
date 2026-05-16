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

import {
  reviewRequestChannelEnum,
  reviewRequestOutcomeEnum,
} from './_enums';
import { brands } from './brands';
import { locations } from './locations';
import { organizations } from './organizations';

/**
 * Outbound "ask for a review" prompts the user sends to customers.
 *
 * `token` is the lookup key the public landing at `/feedback/[token]`
 * uses. It MUST be globally unique because the landing knows nothing
 * about the org — the token is the only thing connecting the URL to
 * an organization. Tokens are minted in `lib/reviews/public-feedback.ts`
 * (Commit 16) with the format `bnf_` + base64url(randomBytes(24)),
 * giving ~144 bits of entropy and a verifiable prefix that lets the
 * landing reject malformed tokens BEFORE touching the DB (defeats
 * timing-attack-shaped enumeration).
 *
 * `contact_info` is jsonb so we can carry the per-channel payload
 * (`{ email, name }` for email, `{ phone }` for SMS in Phase 9, etc.)
 * without per-channel columns.
 */
export const reviewRequests = pgTable(
  'review_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    channel: reviewRequestChannelEnum('channel').notNull(),
    contactInfo: jsonb('contact_info').notNull().default(sql`'{}'::jsonb`),
    token: text('token').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** NULL until the user submits or the request expires. */
    outcome: reviewRequestOutcomeEnum('outcome'),
    /** Default +30 days at insert time (see migration). */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenUnique: uniqueIndex('review_requests_token_unique').on(table.token),
    orgSentIdx: index('review_requests_org_sent_idx').on(
      table.organizationId,
      table.sentAt,
    ),
    orgLocationIdx: index('review_requests_org_location_idx').on(
      table.organizationId,
      table.locationId,
    ),
  }),
);

export type ReviewRequest = typeof reviewRequests.$inferSelect;
export type NewReviewRequest = typeof reviewRequests.$inferInsert;
