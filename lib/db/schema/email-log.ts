import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations';

/**
 * Transactional email audit log (Phase 11 / C44). One row per send attempt.
 *
 * `organization_id` is NULL for system emails not tied to a tenant. Tenant
 * rows are RLS-readable by that org; system (null-org) rows are invisible to
 * tenants and only readable by service_role. Writes go through service_role
 * (the email client / Inngest function).
 *
 * Privacy: we store the recipient `to` address (first-party PII, needed for
 * ops / Resend lookups; the table is RLS-scoped + service-role-written) but
 * NEVER the email BODY.
 */
export const emailLog = pgTable(
  'email_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** NULL for system emails (not tenant-scoped). */
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    to: text('to').notNull(),
    template: text('template').notNull(),
    locale: text('locale').notNull().default('en'),
    /** 'queued' | 'sent' | 'failed'. */
    status: text('status').notNull().default('queued'),
    /** Resend message id when the real provider sent it. */
    resendId: text('resend_id'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgCreatedIdx: index('email_log_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
    ),
  }),
);

export type EmailLogRow = typeof emailLog.$inferSelect;
export type NewEmailLogRow = typeof emailLog.$inferInsert;
