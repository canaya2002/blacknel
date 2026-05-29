import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { metaDeletionStatusEnum } from './_enums';

/**
 * Records every `signed_request` POST received at
 * `/api/meta/data-deletion`. The route handler inserts a `pending`
 * row; a future deletion cron (TBD C50) reads pending rows, purges
 * the user's data across our tables, and marks them processed.
 *
 * `meta_user_id` is the Facebook/Instagram external identifier from
 * the signed_request payload — NOT our internal `public.users.id`.
 * Resolution to our internal user happens (best-effort) inside the
 * deletion job by joining against `connected_accounts.external_*`.
 *
 * No RLS — system table. service_role only.
 */
export const metaDeletionRequests = pgTable(
  'meta_deletion_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    metaUserId: text('meta_user_id').notNull(),
    signedRequest: text('signed_request').notNull(),
    confirmationCode: uuid('confirmation_code').notNull().unique().defaultRandom(),
    status: metaDeletionStatusEnum('status').notNull().default('pending'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => ({
    statusIdx: index('meta_deletion_requests_status_idx').on(
      table.status,
      table.createdAt,
    ),
    userIdx: index('meta_deletion_requests_user_idx').on(table.metaUserId),
  }),
);

export type MetaDeletionRequest = typeof metaDeletionRequests.$inferSelect;
export type NewMetaDeletionRequest = typeof metaDeletionRequests.$inferInsert;
