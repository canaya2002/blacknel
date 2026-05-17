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

import { npsSurveyChannelEnum } from './_enums';
import { brands } from './brands';
import { npsSurveys } from './nps-surveys';
import { organizations } from './organizations';

/**
 * One outbound NPS survey invitation (Phase 9 / Commit 32).
 *
 * `token` is the URL-safe public identifier landing on `/nps/[token]`
 * — minted by `lib/nps/tokens.ts` with format `bnf_nps_<32 chars
 * base64url>`. The same token is the only thing connecting the
 * unauthenticated landing back to the org, so its uniqueness MUST be
 * DB-enforced (not just app-enforced) — hence the dedicated UNIQUE
 * constraint.
 *
 * `idempotency_key` (D-32-4) is a dedicated nullable column with a
 * partial unique index `WHERE NOT NULL`. The sender writes it when
 * the caller passes one (e.g. a deterministic per-event-id key);
 * nullable so manual-trigger sends can omit it. Picking a column over
 * `metadata->>'idempotency_key'` avoids the Drupal-pattern problem
 * the Commit 31 Sub-1 decision already rejected.
 *
 * SQL-only generated column: `sent_on_date date GENERATED ALWAYS AS
 * ((sent_at AT TIME ZONE 'UTC')::date) STORED`. The per-day unique
 * index lives on it (D-32-5). It is intentionally absent from this
 * Drizzle row type — the same pattern as `inbox_messages.search_tsv`
 * — since app code never reads or writes it directly; the index does
 * its job server-side.
 *
 * `metadata jsonb` stays for genuinely-open keys (source event id,
 * dev outbox preview ref, etc.). It is NOT used for idempotency.
 */
export const npsInvitations = pgTable(
  'nps_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    npsSurveyId: uuid('nps_survey_id')
      .notNull()
      .references(() => npsSurveys.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    contactIdentifier: text('contact_identifier').notNull(),
    contactName: text('contact_name'),
    channel: npsSurveyChannelEnum('channel').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`(now() + INTERVAL '30 days')`),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    idempotencyKey: text('idempotency_key'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tokenUnique: uniqueIndex('nps_invitations_token_unique').on(table.token),
    // `nps_invitations_one_per_day` declared SQL-side in 0015 because
    // the column it references (`sent_on_date`) is the generated
    // column not exposed in this Drizzle type.
    idempotencyUnique: uniqueIndex('nps_invitations_idempotency_unique')
      .on(table.organizationId, table.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    surveyContactSentIdx: index(
      'nps_invitations_survey_contact_sent_idx',
    ).on(table.npsSurveyId, table.contactIdentifier, table.sentAt),
    orgSentIdx: index('nps_invitations_org_sent_idx').on(
      table.organizationId,
      table.sentAt,
    ),
  }),
);

export type NpsInvitation = typeof npsInvitations.$inferSelect;
export type NewNpsInvitation = typeof npsInvitations.$inferInsert;
