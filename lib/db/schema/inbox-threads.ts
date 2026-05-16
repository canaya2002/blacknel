import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import {
  inboxSentimentEnum,
  inboxThreadKindEnum,
  inboxThreadPriorityEnum,
  inboxThreadStatusEnum,
} from './_enums';
import { brands } from './brands';
import { connectedAccounts } from './connected-accounts';
import { contactProfiles } from './contact-profiles';
import { locations } from './locations';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Top-level inbox unit. A thread is a continuous conversation surface
 * (DM, comment chain, review, mention) tied to a single contact + a
 * single connected account.
 *
 * `sla_breach_at` is intentionally NULL through Phase 4. Phase 9 (Growth
 * features) introduces per-brand SLA policy (priority → minutes-to-first-
 * response) and a background job that fills this column. Reads must
 * tolerate NULL — "no SLA configured yet" is the dominant state.
 *
 * `tags` is jsonb (array of strings) with a GIN index in SQL — Drizzle
 * doesn't model GIN, see `0005_inbox.sql`.
 */
export const inboxThreads = pgTable(
  'inbox_threads',
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
    contactProfileId: uuid('contact_profile_id').references(() => contactProfiles.id, {
      onDelete: 'set null',
    }),
    platform: text('platform').notNull(),
    externalThreadId: text('external_thread_id'),
    kind: inboxThreadKindEnum('kind').notNull(),
    status: inboxThreadStatusEnum('status').notNull().default('open'),
    priority: inboxThreadPriorityEnum('priority').notNull().default('normal'),
    sentiment: inboxSentimentEnum('sentiment').notNull().default('unknown'),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    subject: text('subject'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    /** TODO(blacknel-phase-9): computed from priority + brand SLA policy. */
    slaBreachAt: timestamp('sla_breach_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    tags: jsonb('tags').notNull().default(sql`'[]'::jsonb`),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index('inbox_threads_org_status_idx').on(table.organizationId, table.status),
    orgLastMessageIdx: index('inbox_threads_org_last_message_idx').on(
      table.organizationId,
      table.lastMessageAt,
    ),
    orgAssignedIdx: index('inbox_threads_org_assigned_idx').on(
      table.organizationId,
      table.assignedTo,
    ),
    orgPriorityIdx: index('inbox_threads_org_priority_idx').on(
      table.organizationId,
      table.priority,
    ),
    orgPlatformExternalUnique: uniqueIndex('inbox_threads_org_platform_external_unique')
      .on(table.organizationId, table.platform, table.externalThreadId)
      .where(sql`external_thread_id IS NOT NULL`),
  }),
);

export type InboxThread = typeof inboxThreads.$inferSelect;
export type NewInboxThread = typeof inboxThreads.$inferInsert;
