import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditAnomalyKindEnum, auditAnomalyStatusEnum } from './_enums';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Detected audit anomalies (Phase 10 / Commit 37).
 *
 * Produced by the `audit-anomaly-scan` cron tick from heuristic
 * rules over `audit_events`. Lifecycle:
 *
 *   pending → dismissed | accepted
 *
 * # decided_reason CHECK (Ajuste 1)
 *
 * Compliance requires explaining "why was this dismissed". DB
 * CHECK enforces `decided_reason` (≥10 chars, trimmed) when
 * `status != 'pending'`. Pending rows allow NULL.
 *
 * `evidence` (jsonb) carries the heuristic's supporting data —
 * varies by `kind`:
 *
 *   - `off_hours_access`: `{ events: [{id, action, hour}], threshold }`
 *   - `new_ip`: `{ ip, prior_ips: [string], first_seen_at }`
 *   - `mass_export`: `{ event_id, rows, size_bytes, threshold }`
 */
export const auditAnomalies = pgTable(
  'audit_anomalies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: auditAnomalyKindEnum('kind').notNull(),
    status: auditAnomalyStatusEnum('status').notNull().default('pending'),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    evidence: jsonb('evidence').notNull().default(sql`'{}'::jsonb`),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    decidedReason: text('decided_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index('audit_anomalies_org_status_idx').on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    orgKindIdx: index('audit_anomalies_kind_idx').on(
      table.organizationId,
      table.kind,
      table.createdAt,
    ),
    decidedReasonRequired: check(
      'audit_anomalies_decided_reason_when_decided',
      sql`status = 'pending' OR (decided_reason IS NOT NULL AND length(btrim(decided_reason)) >= 10)`,
    ),
  }),
);

export type AuditAnomaly = typeof auditAnomalies.$inferSelect;
export type NewAuditAnomaly = typeof auditAnomalies.$inferInsert;
export type AuditAnomalyKind = AuditAnomaly['kind'];
export type AuditAnomalyStatus = AuditAnomaly['status'];
