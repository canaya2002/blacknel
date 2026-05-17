import { sql } from 'drizzle-orm';
import { type AnyPgColumn } from 'drizzle-orm/pg-core';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import {
  inboxMessageAuthorTypeEnum,
  inboxMessageDirectionEnum,
} from './_enums';
import { inboxThreads } from './inbox-threads';
import { organizations } from './organizations';
import { whatsappTemplates } from './whatsapp-templates';

/**
 * Append-only message log.
 *
 * `organization_id` is **denormalized** from the parent thread so RLS
 * policies can read it directly without a subquery. A BEFORE INSERT
 * trigger (see `0005_inbox.sql`) copies it from `inbox_threads.organization_id`
 * when callers leave it NULL. Same pattern as `connected_accounts` /
 * `internal_notes`. Tested in `tests/integration/inbox-actions.test.ts`.
 *
 * Full-text search is backed by a SQL-only generated column `search_tsv`
 * (`to_tsvector('simple', body)`) plus a GIN index — declared in the
 * migration but intentionally absent from this Drizzle row type. App code
 * builds the `to_tsquery()` predicate against the raw SQL column.
 *
 * `idempotency_key` carries the outbound send key for retries; the partial
 * unique index (thread_id, idempotency_key) WHERE idempotency_key IS NOT NULL
 * keeps the column open for inbound messages that don't have one.
 */
export const inboxMessages = pgTable(
  'inbox_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => inboxThreads.id, { onDelete: 'cascade' }),
    direction: inboxMessageDirectionEnum('direction').notNull(),
    authorType: inboxMessageAuthorTypeEnum('author_type').notNull(),
    authorId: uuid('author_id'),
    body: text('body').notNull().default(''),
    media: jsonb('media').notNull().default(sql`'[]'::jsonb`),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    externalMessageId: text('external_message_id'),
    idempotencyKey: text('idempotency_key'),
    /**
     * WhatsApp template provenance (Phase 9 / Commit 31).
     *
     * NULL for free-form messages and for every non-WhatsApp
     * platform. Populated when an outbound message originated
     * from `sendTemplateAction` via a `whatsapp_templates` row.
     *
     * Charter touch: column es nullable, sin default, FK ON
     * DELETE SET NULL → no afecta rows históricos de Phase 4 ni
     * altera inserts existentes que no setean el campo.
     * Partial index restringe el storage al subset WhatsApp.
     */
    whatsappTemplateId: uuid('whatsapp_template_id').references(
      (): AnyPgColumn => whatsappTemplates.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadSentIdx: index('inbox_messages_thread_sent_idx').on(table.threadId, table.sentAt),
    orgSentIdx: index('inbox_messages_org_sent_idx').on(table.organizationId, table.sentAt),
    threadIdempotencyUnique: uniqueIndex('inbox_messages_thread_idempotency_unique')
      .on(table.threadId, table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    whatsappTemplateIdx: index('inbox_messages_whatsapp_template_idx')
      .on(table.whatsappTemplateId)
      .where(sql`whatsapp_template_id IS NOT NULL`),
  }),
);

export type InboxMessage = typeof inboxMessages.$inferSelect;
export type NewInboxMessage = typeof inboxMessages.$inferInsert;
