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

import { postStatusEnum } from './_enums';
import { brands } from './brands';
import { campaigns } from './campaigns';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Outbound social-media post. A `posts` row is the LOGICAL post —
 * the manager's intent ("publish X to these N accounts"). Each
 * destination account materializes as a separate `post_targets`
 * row, which is what actually gets pushed to a platform.
 *
 * Why two tables? The same post may publish to 5 accounts; 3
 * succeed and 2 fail with platform-specific errors. The composer
 * needs ONE intent to edit ("the September promo announcement");
 * the publish-job needs PER-DESTINATION granularity for retries,
 * idempotency, and reporting. Splitting the row removes ambiguity.
 *
 * # Lifecycle
 *
 * Transitions are documented on `postStatusEnum` in `_enums.ts`.
 * The publish-job (Commit 20) is the only writer that transitions
 * `scheduled → publishing → published|failed`; everything earlier
 * runs through Server Actions.
 *
 * # Idempotency
 *
 * `idempotency_key` is set by the client at compose time. It
 * survives across "save draft" / "schedule" so a user double-
 * clicking "Schedule" can't queue the same post twice. Partial
 * unique on `(organization_id, idempotency_key) WHERE idempotency_key
 * IS NOT NULL` enforces this — `NULL` keys (drafts that haven't
 * decided to ship yet) are allowed to duplicate.
 *
 * Each `post_target` also carries ITS OWN `idempotency_key`,
 * scoped to that destination. The two keys are independent: the
 * post-level key prevents duplicate logical intents; the
 * target-level key prevents duplicate per-account dispatches even
 * if the publish-job is re-run. Both partial uniques.
 *
 * # `media_ids`
 *
 * jsonb array of `content_assets.id` UUIDs. The composer references
 * assets by id rather than copying URLs so renaming / replacing an
 * asset propagates. The publish-job resolves the array to URLs at
 * dispatch time (`content_assets.url`).
 *
 * # `utm`
 *
 * `{ source, medium, campaign, term, content }` — five optional
 * keys, all string. The composer's UTM builder writes this; the
 * publish-job appends them to `link` before dispatching.
 *
 * # Usage counter
 *
 * `postsPerMonth` (windowed counter, defined in
 * `lib/usage/counters.ts`) increments when this row transitions to
 * `published`. Drafts and scheduled posts do NOT count — only
 * published, per the master prompt's plan-limit semantics. Standard
 * caps at 30 / Growth 250 / Enterprise unlimited.
 */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    status: postStatusEnum('status').notNull().default('draft'),
    text: text('text').notNull().default(''),
    /** Array of `content_assets.id` UUIDs. */
    mediaIds: jsonb('media_ids').notNull().default(sql`'[]'::jsonb`),
    link: text('link'),
    /** `{ source?, medium?, campaign?, term?, content? }`. */
    utm: jsonb('utm').notNull().default(sql`'{}'::jsonb`),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** Set by the composer at intent time. Defends against double-schedule. */
    idempotencyKey: text('idempotency_key'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index('posts_org_status_idx').on(table.organizationId, table.status),
    orgScheduledIdx: index('posts_org_scheduled_idx').on(
      table.organizationId,
      table.scheduledAt,
    ),
    orgCampaignIdx: index('posts_org_campaign_idx').on(
      table.organizationId,
      table.campaignId,
    ),
    orgIdempotencyUnique: uniqueIndex('posts_org_idempotency_unique')
      .on(table.organizationId, table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
  }),
);

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
