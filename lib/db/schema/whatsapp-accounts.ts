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

import { connectedAccounts } from './connected-accounts';
import { organizations } from './organizations';

/**
 * WhatsApp Business account config (Phase 9 / Commit 31).
 *
 * Sits alongside the corresponding `connected_accounts` row —
 * the latter owns connection-state lifecycle (connected /
 * disconnected / expired / error), this one carries Meta-API
 * specifics (phone_number_id, business_account_id). One row
 * per `(org, phone_number)` — re-connecting flips the parent
 * `connected_accounts.status` back to 'connected' instead of
 * inserting a duplicate.
 *
 * **Why two tables?** Phase-3 `connected_accounts` is platform-
 * agnostic. The Meta App credentials shape (WABA + phone-number
 * id + business-account id) is WhatsApp-only and would pollute
 * the parent row if inlined as columns. Pattern matches Phase-8
 * `ads_accounts`-vs-`connected_accounts` split.
 */
export const whatsappAccounts = pgTable(
  'whatsapp_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
    phoneNumber: text('phone_number').notNull(),
    phoneNumberId: text('phone_number_id').notNull(),
    businessAccountId: text('business_account_id').notNull(),
    displayName: text('display_name'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgPhoneUnique: uniqueIndex('whatsapp_accounts_org_phone_unique').on(
      table.organizationId,
      table.phoneNumber,
    ),
    connectedAccountIdx: index('whatsapp_accounts_connected_account_idx').on(
      table.connectedAccountId,
    ),
  }),
);

export type WhatsappAccount = typeof whatsappAccounts.$inferSelect;
export type NewWhatsappAccount = typeof whatsappAccounts.$inferInsert;
