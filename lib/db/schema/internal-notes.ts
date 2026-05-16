import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { inboxThreads } from './inbox-threads';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Private notes a team leaves on a thread. Not visible to the contact.
 *
 * `organization_id` is denormalized (auto-set by BEFORE INSERT trigger from
 * `inbox_threads.organization_id`) so the RLS policy is a plain equality
 * check, not a subquery. Mirrors the pattern in `inbox_messages`.
 *
 * `mentions` is jsonb (array of user ids) so future @mention notifications
 * have a structured lookup. Phase 9 (Growth — Advanced Notes) actually
 * fires notifications; Phase 4 just stores them.
 */
export const internalNotes = pgTable(
  'internal_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => inboxThreads.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    mentions: jsonb('mentions').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadIdx: index('internal_notes_thread_idx').on(table.threadId),
    orgPinnedIdx: index('internal_notes_org_pinned_idx')
      .on(table.organizationId, table.pinned)
      .where(sql`pinned = true`),
  }),
);

export type InternalNote = typeof internalNotes.$inferSelect;
export type NewInternalNote = typeof internalNotes.$inferInsert;
