import 'server-only';

import { and, eq } from 'drizzle-orm';

import { type AnyPgTx } from '../../db/client';
import { reviewResponses, reviews } from '../../db/schema';
import { AppError } from '../../errors';

/**
 * Dispatches an approved `review_response` approval.
 *
 * Pattern parallels `inbox-reply.ts` (Commit 10) — runs inside the
 * same authenticated transaction as the approvals.status update, so
 * the side effect rolls back if anything raises.
 *
 * Key difference vs inbox:
 *
 *   - The `review_responses` row already exists. `send-response.ts`
 *     created it in `status='pending_approval'` at the moment the
 *     approval was queued (so the row carries `idempotency_key`,
 *     `ai_generated`, and the original draft body, which the approval
 *     queue surface needs to show the diff). Dispatch only flips the
 *     row's status — no INSERT.
 *
 *   - Two row updates inside the same txn:
 *       1. `review_responses.status='published'` + publishedAt=now
 *          + finalText=proposedPayload.body (lets `approveWithEdits`
 *          override the draft text without mutating the original
 *          response row separately).
 *       2. `reviews.status='responded'` (lifecycle transition per the
 *          enum doc on _enums.ts: pending|in_progress → responded).
 *
 *   - Concurrency: the SELECT FOR UPDATE on the parent `approvals`
 *     row in `approveAction` is the lock that prevents two managers
 *     publishing simultaneously. If a second tx waits for the lock,
 *     reads the status, and sees `status='approved'`, the action
 *     returns APPROVAL_ALREADY_DECIDED before reaching this
 *     dispatcher. Same guarantee as inbox dispatch.
 *
 * Audit `review.response.published` is written by the caller
 * (`approveAction`) AFTER the txn commits — same audit-timing trade-off
 * as inbox, tracked in TODO.md#audit-events-atomicity.
 */

interface ReviewResponsePayload {
  kind: 'review_response';
  reviewId: string;
  reviewRating?: number;
  responseId: string;
  body: string;
  aiGenerated?: boolean;
  complianceFlags?: ReadonlyArray<string>;
  complianceReasoning?: string;
}

export interface ReviewResponseApprovalRow {
  id: string;
  organizationId: string;
  entityId: string;
  proposedPayload: unknown;
}

function isReviewResponsePayload(value: unknown): value is ReviewResponsePayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === 'review_response' &&
    typeof v.reviewId === 'string' &&
    typeof v.responseId === 'string' &&
    typeof v.body === 'string'
  );
}

export async function dispatchReviewResponseApproval(
  tx: AnyPgTx,
  approval: ReviewResponseApprovalRow,
  _actorUserId: string,
): Promise<{ reviewResponseId: string; reviewId: string }> {
  if (!isReviewResponsePayload(approval.proposedPayload)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Approval ${approval.id} proposed_payload is not a valid review_response shape.`,
      { meta: { approvalId: approval.id } },
    );
  }
  const payload = approval.proposedPayload;

  // Defense in depth: the response row should still exist and still
  // be in `pending_approval`. If a concurrent path already flipped
  // it (e.g., a sibling Server Action), don't double-publish.
  const responseRows = await tx
    .select({
      id: reviewResponses.id,
      status: reviewResponses.status,
      reviewId: reviewResponses.reviewId,
    })
    .from(reviewResponses)
    .where(
      and(
        eq(reviewResponses.id, approval.entityId),
        eq(reviewResponses.organizationId, approval.organizationId),
      ),
    )
    .limit(1);
  if (responseRows.length === 0) {
    throw new AppError(
      'NOT_FOUND',
      'Response row referenced by this approval no longer exists.',
      { meta: { approvalId: approval.id, responseId: approval.entityId } },
    );
  }
  const responseRow = responseRows[0]!;
  if (responseRow.status === 'published') {
    // The row is already published. Either approve was double-clicked
    // and the first won and committed, or some out-of-band script
    // moved the row. Either way we don't republish.
    throw new AppError(
      'CONFLICT',
      'Esta respuesta ya fue publicada.',
      {
        meta: {
          approvalId: approval.id,
          responseId: responseRow.id,
          status: responseRow.status,
        },
      },
    );
  }
  if (responseRow.status === 'rejected') {
    throw new AppError(
      'CONFLICT',
      'La respuesta fue rechazada previamente y no se puede publicar.',
      { meta: { approvalId: approval.id, responseId: responseRow.id } },
    );
  }

  const now = new Date();

  await tx
    .update(reviewResponses)
    .set({
      status: 'published',
      finalText: payload.body,
      publishedAt: now,
    })
    .where(eq(reviewResponses.id, responseRow.id));

  await tx
    .update(reviews)
    .set({ status: 'responded' })
    .where(
      and(
        eq(reviews.id, payload.reviewId),
        eq(reviews.organizationId, approval.organizationId),
      ),
    );

  return {
    reviewResponseId: responseRow.id,
    reviewId: payload.reviewId,
  };
}

/**
 * Reject path. Called by `rejectAction` AFTER it has locked the
 * approval row and decided to reject. Flips the response row to
 * `rejected` so the composer surface reflects the outcome.
 *
 * Idempotent: if the row is already rejected, treat as no-op (the
 * approval row's locked-status check already caught the double).
 */
export async function dispatchReviewResponseRejection(
  tx: AnyPgTx,
  approval: ReviewResponseApprovalRow,
): Promise<{ reviewResponseId: string }> {
  if (!isReviewResponsePayload(approval.proposedPayload)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Approval ${approval.id} proposed_payload is not a valid review_response shape.`,
      { meta: { approvalId: approval.id } },
    );
  }
  await tx
    .update(reviewResponses)
    .set({ status: 'rejected' })
    .where(
      and(
        eq(reviewResponses.id, approval.entityId),
        eq(reviewResponses.organizationId, approval.organizationId),
      ),
    );
  return { reviewResponseId: approval.entityId };
}
