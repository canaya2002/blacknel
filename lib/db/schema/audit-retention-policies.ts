import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations';
import { users } from './users';

/**
 * Per-org audit retention policies (Phase 10 / Commit 37).
 *
 * # Precedence rule (Ajuste 2)
 *
 * Multiple policies can overlap per org. When resolving an event's
 * retention, the rule is:
 *
 *   1. **Specificity wins**: exact match > prefix `'x.*'` > `'all'`.
 *   2. **Longer retention wins** on ties (defense in depth — we'd
 *      rather keep audit data too long than purge too early).
 *
 * Documented + tested in `lib/audit-advanced/retention.ts`.
 */
export const auditRetentionPolicies = pgTable(
  'audit_retention_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /**
     * Pattern: `'all'` (org-wide catch-all), `'billing.*'` (prefix
     * match), or exact action name like `'billing.charge'`.
     */
    appliesTo: text('applies_to').notNull(),
    retentionDays: integer('retention_days').notNull(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdx: index('audit_retention_org_idx').on(table.organizationId),
    orgPatternUnique: uniqueIndex(
      'audit_retention_org_pattern_unique',
    ).on(table.organizationId, table.appliesTo),
    daysPositive: check(
      'audit_retention_days_positive',
      sql`retention_days > 0`,
    ),
  }),
);

export type AuditRetentionPolicy = typeof auditRetentionPolicies.$inferSelect;
export type NewAuditRetentionPolicy =
  typeof auditRetentionPolicies.$inferInsert;
