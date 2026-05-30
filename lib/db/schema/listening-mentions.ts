import { sql } from 'drizzle-orm';
import { type AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  inboxSentimentEnum,
  listeningMentionKindEnum,
  listeningMentionStatusEnum,
} from './_enums';
import { brands } from './brands';
import { connectedAccounts } from './connected-accounts';
import { inboxThreads } from './inbox-threads';
import { listeningTrackedTerms } from './listening-tracked-terms';
import { organizations } from './organizations';

/**
 * Captured listening mention (Phase 9 / Commit 33).
 *
 * `sentiment` reuses the Phase-4 `inbox_sentiment` enum (positive /
 * neutral / negative / unknown) so a single classifier output type
 * works across the inbox AND the listening surface. `sentiment_
 * score` (numeric 3,2) holds the AI confidence ∈ [0, 1] — `numeric`
 * not `real` so analytics math doesn't drift.
 *
 * `is_lead` is the AI-intent-derived "this is a sales prospect"
 * flag. Set at capture time by the cron via `lib/ai/skills/intent`.
 * The R-33-1 invariant: the SEED never invokes AI skills; mentions
 * pre-classified inside `seed-listening.ts` carry deterministic
 * sentiment + is_lead values.
 *
 * `assigned_thread_id` is the half of the discover→triage→operate
 * loop where a manager has promoted the mention to an inbox thread.
 * The other half — `inbox_threads.source_mention_id` — was the
 * Phase-4 charter touch in this migration (R-33-2). The FK to
 * `inbox_threads(id)` is added in migration 0016 via a separate
 * ALTER once both tables exist.
 */
export const listeningMentions = pgTable(
  'listening_mentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // Nullable since C53: account-discovered @mentions/tags match no tracked term.
    trackedTermId: uuid('tracked_term_id').references(() => listeningTrackedTerms.id, {
      onDelete: 'cascade',
    }),
    // C53 — which connected account surfaced this mention (the "connection ref").
    connectedAccountId: uuid('connected_account_id').references(
      () => connectedAccounts.id,
      { onDelete: 'set null' },
    ),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    platform: text('platform').notNull(),
    externalId: text('external_id').notNull(),
    authorHandle: text('author_handle').notNull(),
    authorDisplayName: text('author_display_name'),
    body: text('body').notNull(),
    url: text('url'),
    kind: listeningMentionKindEnum('kind').notNull().default('post'),
    sentiment: inboxSentimentEnum('sentiment').notNull().default('unknown'),
    sentimentScore: numeric('sentiment_score', {
      precision: 3,
      scale: 2,
    })
      .notNull()
      .default('0'),
    isLead: boolean('is_lead').notNull().default(false),
    status: listeningMentionStatusEnum('status').notNull().default('new'),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    assignedThreadId: uuid('assigned_thread_id').references(
      (): AnyPgColumn => inboxThreads.id,
      { onDelete: 'set null' },
    ),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    externalUnique: uniqueIndex('listening_mentions_external_unique').on(
      table.organizationId,
      table.platform,
      table.externalId,
    ),
    orgStatusCapturedIdx: index(
      'listening_mentions_org_status_captured_idx',
    ).on(table.organizationId, table.status, table.capturedAt),
    orgLeadIdx: index('listening_mentions_org_lead_idx')
      .on(table.organizationId, table.isLead, table.capturedAt)
      .where(sql`is_lead = true`),
    brandStatusIdx: index('listening_mentions_brand_status_idx').on(
      table.brandId,
      table.status,
    ),
    trackedTermIdx: index('listening_mentions_tracked_term_idx').on(
      table.trackedTermId,
      table.capturedAt,
    ),
    assignedThreadIdx: index('listening_mentions_assigned_thread_idx')
      .on(table.assignedThreadId)
      .where(sql`assigned_thread_id IS NOT NULL`),
    connectedAccountIdx: index('listening_mentions_connected_account_idx')
      .on(table.connectedAccountId)
      .where(sql`connected_account_id IS NOT NULL`),
    scoreRange: check(
      'listening_mentions_sentiment_score_range',
      sql`sentiment_score >= 0 AND sentiment_score <= 1`,
    ),
  }),
);

export type ListeningMention = typeof listeningMentions.$inferSelect;
export type NewListeningMention = typeof listeningMentions.$inferInsert;
export type ListeningMentionKind = ListeningMention['kind'];
export type ListeningMentionStatus = ListeningMention['status'];
