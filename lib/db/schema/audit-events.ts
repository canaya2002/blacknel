import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { auditActorTypeEnum } from './_enums';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Append-only audit log. Records every meaningful action — who did what,
 * to which entity, with what change. Powers the Enterprise audit UI and
 * is the source of truth when investigating an incident.
 *
 * `organization_id` is nullable for system-wide events (cron failures,
 * platform updates). RLS treats NULL org_id as visible only via admin.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    actorType: auditActorTypeEnum('actor_type').notNull().default('user'),
    /** Dot-notation event name: `inbox.thread.assigned`, `auth.user.signed_in`, etc. */
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    riskLevel: text('risk_level'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgCreatedIdx: index('audit_events_org_created_idx').on(
      table.organizationId,
      table.createdAt,
    ),
    entityIdx: index('audit_events_entity_idx').on(table.entityType, table.entityId),
    actionIdx: index('audit_events_action_idx').on(table.action),
  }),
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
