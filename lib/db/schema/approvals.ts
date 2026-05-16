import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import {
  approvalKindEnum,
  approvalRiskLevelEnum,
  approvalStatusEnum,
} from './_enums';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Generic approval queue. One row per pending decision; the polymorphic
 * link is `(entity_table, entity_id)`. The valid table set is enforced by
 * a CHECK constraint in SQL (see `0005_inbox.sql`) — adding a new entity
 * is a migration, not a runtime concern.
 *
 * # Payload contract by kind
 *
 * Two jsonb columns hold the request:
 *
 *   - `proposed_payload` — what the requester wants applied. ALWAYS set.
 *   - `original_payload` — the prior state we're replacing. Null for
 *     "fresh" approvals where nothing existed before (the most common
 *     case for `kind='inbox_reply'`).
 *
 * `approveWithEdits` MUTATES this pair: the prior `proposed_payload` is
 * moved into `original_payload`, and the new edited payload is written
 * to `proposed_payload`. That yields a clean before/after diff for the
 * audit log — see `tests/integration/approvals-actions.test.ts`.
 *
 * Per kind:
 *
 *   - `inbox_reply`:    proposed = { kind, threadId, messageBody, language,
 *                                    savedReplyId?, aiGenerated }
 *                       original = null on first approval; previous proposed
 *                                  after `approveWithEdits`.
 *   - `review_response` (Phase 5): proposed/original = { reviewId, body, … }.
 *   - `post`            (Phase 6): proposed/original = full post draft.
 *
 * # Risk + AI flags
 *
 * `ai_risk_flags` is an array of `ComplianceFlag` strings the IA layer
 * stamped on the proposal. Phase 4 uses a stub (`compliance-stub.ts`);
 * Phase 7 swaps it for the real classifier without changing this column.
 */
export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: approvalKindEnum('kind').notNull(),
    /**
     * Lookup hint for joins. Restricted in SQL via CHECK constraint to
     * the set: ('inbox_messages', 'posts', 'review_responses'). Extending
     * the set is a migration step.
     */
    entityTable: text('entity_table').notNull(),
    entityId: uuid('entity_id').notNull(),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    status: approvalStatusEnum('status').notNull().default('pending'),
    riskLevel: approvalRiskLevelEnum('risk_level').notNull().default('low'),
    aiRiskFlags: jsonb('ai_risk_flags').notNull().default(sql`'[]'::jsonb`),
    originalPayload: jsonb('original_payload'),
    proposedPayload: jsonb('proposed_payload').notNull(),
    decisionReason: text('decision_reason'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index('approvals_org_status_idx').on(table.organizationId, table.status),
    orgKindIdx: index('approvals_org_kind_idx').on(table.organizationId, table.kind),
    assignedIdx: index('approvals_assigned_idx').on(table.assignedTo),
  }),
);

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;

/** Set of entity tables an approval may point at. Mirrored by SQL CHECK. */
export const APPROVAL_ENTITY_TABLES = [
  'inbox_messages',
  'posts',
  'review_responses',
] as const;
export type ApprovalEntityTable = (typeof APPROVAL_ENTITY_TABLES)[number];
