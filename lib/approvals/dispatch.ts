import 'server-only';

import { type AnyPgTx } from '../db/client';
import { AppError } from '../errors';

import {
  dispatchInboxReplyApproval,
  type InboxApprovalRow,
} from './dispatchers/inbox-reply';
import {
  dispatchPostApproval,
  dispatchPostRejection,
  type PostApprovalRow,
} from './dispatchers/post';
import {
  dispatchReviewResponseApproval,
  dispatchReviewResponseRejection,
  type ReviewResponseApprovalRow,
} from './dispatchers/review-response';

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
  /** Set when the dispatched approval transitioned a review_response. */
  readonly reviewResponseId?: string;
  /** Set when the dispatched approval transitioned a review_response. */
  readonly reviewId?: string;
  /** Set when the dispatched approval transitioned a post (Commit 20b). */
  readonly postId?: string;
  /**
   * Terminal status the post landed in — `'scheduled'` (cron picks up at
   * `scheduled_at`) or `'publishing'` (caller should kick the cron sync).
   */
  readonly postToStatus?: 'scheduled' | 'publishing' | 'cancelled';
  /**
   * `true` when the caller should invoke `runPublishTick()` after the
   * txn commits to drain the post's pending targets sync. False when
   * the post landed in `'scheduled'` (the cron's normal Set A handles it).
   */
  readonly postNeedsSyncDispatch?: boolean;
  /** ISO `scheduled_at` from the proposed_payload, for revalidation context. */
  readonly postScheduledAtIso?: string | null;
  /** True when an `editedText` override was applied to `posts.text`. */
  readonly postTextEdited?: boolean;
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
    case 'review_responses': {
      const { reviewResponseId, reviewId } = await dispatchReviewResponseApproval(
        tx,
        approval as ReviewResponseApprovalRow,
        actorUserId,
      );
      return { reviewResponseId, reviewId };
    }
    case 'posts': {
      const result = await dispatchPostApproval(
        tx,
        approval as PostApprovalRow,
        actorUserId,
      );
      return {
        postId: result.postId,
        postToStatus: result.toStatus as 'scheduled' | 'publishing',
        postNeedsSyncDispatch: result.needsSyncDispatch,
        postScheduledAtIso: result.scheduledAtIso,
        postTextEdited: result.textEdited,
      };
    }
    default:
      throw new AppError(
        'INTERNAL_ERROR',
        `Unknown entity_table on approval: "${approval.entityTable}". CHECK constraint should have prevented this.`,
        { meta: { entityTable: approval.entityTable, approvalId: approval.id } },
      );
  }
}

/**
 * Reject-side counterpart. The reject path doesn't dispatch a side
 * effect in the inbox case (no message to un-send) but for review
 * responses it does need to flip the response row to `rejected` so
 * the composer surface reflects the outcome. `rejectAction` calls
 * this from inside its locked transaction.
 */
export async function dispatchRejection(
  tx: AnyPgTx,
  approval: DispatchableApproval,
): Promise<DispatchResult> {
  switch (approval.entityTable) {
    case 'review_responses': {
      const { reviewResponseId } = await dispatchReviewResponseRejection(
        tx,
        approval as ReviewResponseApprovalRow,
      );
      return { reviewResponseId };
    }
    case 'posts': {
      const { postId } = await dispatchPostRejection(
        tx,
        approval as PostApprovalRow,
      );
      return { postId, postToStatus: 'cancelled' };
    }
    case 'inbox_messages':
      // No outbound effect to undo on reject — the row was never created.
      return {};
    default:
      return {};
  }
}
