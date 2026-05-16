import 'server-only';

import { type AnyPgTx } from '../db/client';
import { AppError } from '../errors';

import {
  dispatchInboxReplyApproval,
  type InboxApprovalRow,
} from './dispatchers/inbox-reply';

/**
 * Central dispatcher for approved approvals. Runs INSIDE the
 * authenticated transaction that updates `approvals.status`. If a
 * dispatcher raises, the parent transaction rolls back — leaving the
 * approval pending. This is the only correct behavior: an "approved"
 * row whose side effect didn't fire is worse than no approval at all.
 *
 * Phase migration plan (for Phase 6/7+):
 *
 *   - Today the caller is `approveAction` running synchronously.
 *   - Tomorrow an Inngest job consumes a queue of approved approvals
 *     and invokes the same `dispatchApproved` from the job handler.
 *
 * Signature stays the same — only the caller changes.
 *
 * Per `approvals_entity_table_check` in 0005_inbox.sql, entity_table is
 * one of: 'inbox_messages', 'posts', 'review_responses'. Phase 4
 * implements inbox; the other two throw `NOT_IMPLEMENTED` until the
 * relevant phase wires them.
 */

export interface DispatchableApproval extends InboxApprovalRow {
  entityTable: string;
}

export interface DispatchResult {
  /** Set when the dispatched approval produced an inbox_messages row. */
  readonly messageId?: string;
}

export async function dispatchApproved(
  tx: AnyPgTx,
  approval: DispatchableApproval,
  actorUserId: string,
): Promise<DispatchResult> {
  switch (approval.entityTable) {
    case 'inbox_messages': {
      const { messageId } = await dispatchInboxReplyApproval(tx, approval, actorUserId);
      return { messageId };
    }
    case 'posts':
      throw new AppError(
        'NOT_IMPLEMENTED',
        'Post dispatch lands in Phase 6 (Publishing).',
        { meta: { entityTable: approval.entityTable } },
      );
    case 'review_responses':
      throw new AppError(
        'NOT_IMPLEMENTED',
        'Review response dispatch lands in Phase 5 (Reviews).',
        { meta: { entityTable: approval.entityTable } },
      );
    default:
      throw new AppError(
        'INTERNAL_ERROR',
        `Unknown entity_table on approval: "${approval.entityTable}". CHECK constraint should have prevented this.`,
        { meta: { entityTable: approval.entityTable, approvalId: approval.id } },
      );
  }
}
