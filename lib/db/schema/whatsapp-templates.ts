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

import {
  whatsappTemplateCategoryEnum,
  whatsappTemplateStatusEnum,
} from './_enums';
import { organizations } from './organizations';
import { whatsappAccounts } from './whatsapp-accounts';

/**
 * WhatsApp Business message template (Phase 9 / Commit 31).
 *
 * Mirrors Meta's template-review lifecycle:
 *
 *   pending  → approved (can send) | rejected (with reason)
 *
 * Until a template is `approved`, you cannot send it. The mock
 * connector (`lib/connectors/whatsapp/mock.ts`) reproduces the
 * lifecycle synchronously — a body containing `'FORBIDDEN'` is
 * auto-rejected, everything else is auto-approved. Phase-11
 * swap waits on Meta API's actual `template_status` field
 * (returned by `/templates` endpoint).
 *
 * Body uses Meta's `{{1}}`, `{{2}}` positional placeholder
 * notation. `variables` jsonb stores the per-position label
 * (`[{ position: 1, label: 'first_name' }]`) so the composer
 * UI can render form fields with meaningful captions.
 *
 * **Unique on `(account, name, language)`** matches Meta's API
 * uniqueness — you can have `welcome_message` in both `es` and
 * `en`, but not two `es` `welcome_message` for the same WABA.
 */
export const whatsappTemplates = pgTable(
  'whatsapp_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    whatsappAccountId: uuid('whatsapp_account_id')
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: whatsappTemplateCategoryEnum('category').notNull(),
    language: text('language').notNull(),
    body: text('body').notNull(),
    variables: jsonb('variables').notNull().default(sql`'[]'::jsonb`),
    status: whatsappTemplateStatusEnum('status').notNull().default('pending'),
    rejectedReason: text('rejected_reason'),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    accountNameLangUnique: uniqueIndex('whatsapp_templates_unique').on(
      table.whatsappAccountId,
      table.name,
      table.language,
    ),
    orgStatusIdx: index('whatsapp_templates_org_status_idx').on(
      table.organizationId,
      table.status,
      table.createdAt.desc(),
    ),
    accountStatusIdx: index('whatsapp_templates_account_status_idx').on(
      table.whatsappAccountId,
      table.status,
    ),
  }),
);

export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type NewWhatsappTemplate = typeof whatsappTemplates.$inferInsert;

export type WhatsappTemplateStatus = WhatsappTemplate['status'];
export type WhatsappTemplateCategory = WhatsappTemplate['category'];
