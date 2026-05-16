import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { postTargetStatusEnum } from './_enums';
import { connectedAccounts } from './connected-accounts';
import { organizations } from './organizations';
import { posts } from './posts';

/**
 * Per-destination materialization of a logical `posts` row. One
 * `post_target` row exists for every (post, connected_account)
 * pair the user picked in the composer. The publish-job walks
 * targets independently — failures on one account never block
 * dispatch to the others.
 *
 * # `organization_id` denormalization
 *
 * Same pattern as `inbox_messages` (Commit 7) and `review_responses`
 * (Commit 12). The column is NOT NULL but the BEFORE INSERT trigger
 * `post_targets_set_org_id` stamps it from the parent `posts.
 * organization_id` when the caller passes NULL. Server Actions
 * pass it explicitly; the trigger is defense-in-depth for seeds /
 * dev tools / Phase-11 Inngest jobs.
 *
 * # `platform_variant`
 *
 * Optional jsonb override of the post body / link / media list
 * for this specific platform. Schema:
 *
 *     {
 *       text?: string,       // overrides posts.text for this target
 *       link?: string,       // overrides posts.link
 *       mediaIds?: string[], // overrides posts.media_ids
 *     }
 *
 * NULL / empty object means "inherit everything from the parent
 * post". The composer's "Sub-tab por cuenta" (Commit 19) writes
 * here. The publish-job merges variant over parent at dispatch
 * time.
 *
 * # Idempotency
 *
 * `idempotency_key` is set by the publish-job at the moment it
 * starts dispatching this target. Partial unique on
 * `(post_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
 * prevents the same job re-run from inserting a duplicate dispatch
 * row.
 *
 * # One-success-per-account
 *
 * Partial unique on `(post_id, connected_account_id) WHERE status
 * != 'failed'` enforces that a post never has TWO non-failed
 * targets pointing at the same account. `'failed'` rows are
 * allowed to repeat (retry history) — the policy is "one
 * successful or in-flight target per (post, account)".
 *
 * # Status
 *
 * Transitions: `pending → publishing → published|failed`. The job
 * is the only writer for these; Server Actions read but don't
 * write target status.
 */
export const postTargets = pgTable(
  'post_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
    /** Per-platform override jsonb (see JSDoc on `platform_variant`). */
    platformVariant: jsonb('platform_variant').notNull().default(sql`'{}'::jsonb`),
    status: postTargetStatusEnum('status').notNull().default('pending'),
    externalPostId: text('external_post_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    /**
     * Legacy attempt counter (Commit 17 — pre-job). Commit 20
     * uses `retry_count` for the canonical job-retry path. Kept
     * for backward compatibility; the publish-job does NOT
     * increment it. Phase 11 cleanup may drop it.
     */
    attemptCount: integer('attempt_count').notNull().default(0),
    /**
     * Retry bookkeeping for the publish-job (Commit 20a, migration
     * 0009). `retry_count` increments on every transient failure
     * (publish-job sees the error from the connector). Caps at 3:
     * `retry_count >= 3` → status stays `'failed'` permanently
     * until a manual retry resets it (`retryFailedPostAction` →
     * `retry_count = 0`).
     */
    retryCount: integer('retry_count').notNull().default(0),
    /**
     * Next instant the cron should reattempt this target. Set to
     * `now + backoff` after a transient failure (backoff
     * `[60s, 300s, 900s]` by attempt). `null` when the target is
     * not currently in retry-wait state (i.e. pending /
     * publishing / published, OR failed-permanent).
     */
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    /**
     * Idempotency key passed to the connector to dedupe retries
     * of the same logical dispatch. **Invariant** (Commit 20a):
     * MUST be non-null by the time `dispatchOneTarget` runs.
     * Historical rows are backfilled by migration 0009; fresh
     * rows are stamped at insert time by `createPost`.
     *
     * Defends against job re-runs inserting duplicate dispatches:
     * the connector's `idempotency_key` table dedupes on its end,
     * and the partial unique on `(post_id, idempotency_key)`
     * dedupes on ours.
     */
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    postIdx: index('post_targets_post_idx').on(table.postId),
    accountIdx: index('post_targets_account_idx').on(table.connectedAccountId),
    orgStatusIdx: index('post_targets_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
    /**
     * No two non-failed targets for the same (post, account). Allows
     * retry history with `status='failed'` to accumulate without
     * blocking a fresh attempt.
     */
    postAccountSuccessUnique: uniqueIndex('post_targets_post_account_active_unique')
      .on(table.postId, table.connectedAccountId)
      .where(sql`status <> 'failed'`),
    /**
     * Defends against job re-runs inserting duplicate dispatch rows.
     * NULL keys (the row before the job picks it up) don't dedup.
     */
    postIdempotencyUnique: uniqueIndex('post_targets_post_idempotency_unique')
      .on(table.postId, table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
  }),
);

export type PostTarget = typeof postTargets.$inferSelect;
export type NewPostTarget = typeof postTargets.$inferInsert;
