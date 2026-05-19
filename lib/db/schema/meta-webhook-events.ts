import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { metaWebhookEventStatusEnum } from './_enums';

/**
 * Records every signature-valid POST received at `/api/webhooks/meta`
 * (Facebook, Instagram, WhatsApp Business, Messenger). The route
 * handler inserts a `pending` row and returns 200 immediately so we
 * stay inside Meta's 5-second response budget; the actual fan-out
 * (resolve `event_object` + IDs to one of our organizations and
 * dispatch to the right inbox / review pipeline) runs asynchronously
 * in C45.
 *
 * `event_object` is the top-level `object` field Meta sends, e.g.
 * `'page'` (Facebook page events), `'instagram'`, or
 * `'whatsapp_business_account'`. It is NOT an internal org id —
 * tenancy resolution happens later via `connected_accounts`.
 *
 * `signature` is the raw `sha256=...` header value, retained for
 * audit / forensic re-validation. Not used for routing.
 *
 * No RLS — system table. service_role only.
 */
export const metaWebhookEvents = pgTable(
  'meta_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventObject: text('event_object').notNull(),
    eventPayload: jsonb('event_payload').notNull().default(sql`'{}'::jsonb`),
    signature: text('signature').notNull(),
    status: metaWebhookEventStatusEnum('status').notNull().default('pending'),
    failureReason: text('failure_reason'),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => ({
    statusIdx: index('meta_webhook_events_status_idx').on(
      table.status,
      table.receivedAt,
    ),
    objectIdx: index('meta_webhook_events_object_idx').on(table.eventObject),
  }),
);

export type MetaWebhookEvent = typeof metaWebhookEvents.$inferSelect;
export type NewMetaWebhookEvent = typeof metaWebhookEvents.$inferInsert;
