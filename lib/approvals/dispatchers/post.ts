import 'server-only';

import { and, eq } from 'drizzle-orm';

import { type AnyPgTx } from '../../db/client';
import { posts } from '../../db/schema';
import { AppError } from '../../errors';
import { canTransition, type PostStatus } from '../../publish/status-transitions';

/**
 * Dispatches an approved `post` approval (Commit 20b).
 *
 * Mirrors the inbox-reply / review-response dispatchers — runs INSIDE
 * the same authenticated transaction as `approveAction` so the side
 * effect rolls back if anything raises.
 *
 * # Three approve branches
 *
 *   1. **approve + scheduled_at != null** → flip
 *      `posts.status = 'scheduled'`. The publish-job cron (Set A)
 *      picks it up at `scheduled_at`.
 *   2. **approve + scheduled_at == null** → flip
 *      `posts.status = 'publishing'` AND set `needsSyncDispatch`
 *      on the return so `approveAction` calls `runPublishTick()`
 *      after the txn commits. The extended Set B selector (now
 *      also catches `posts.status='publishing' AND target.status='pending'`)
 *      walks the post's pending targets and dispatches them sync
 *      via `dispatchOneTarget`.
 *   3. **approveWithEdits** — same as 1/2 above, plus updates
 *      `posts.text` from `proposed_payload.editedText` BEFORE the
 *      transition. The approval row's `editedPayload` is what the
 *      `approveAction` layer hands us via `approval.proposedPayload`
 *      (see actions.ts line 311 — the EDITED payload is the
 *      dispatcher's input).
 *
 * # Why we don't re-validate approval rules here
 *
 * `apply-schedule.ts` evaluated rules at the moment the approval
 * was created. The user's role at decision time (`approvals:decide`)
 * is the authorization gate. The dispatcher just lands the outcome
 * the queue surface already committed to.
 *
 * # Concurrency
 *
 * The SELECT FOR UPDATE in `approveAction` locks the parent
 * approval row. A second moderator trying to approve the same row
 * blocks at the SELECT, reads the post-decision status, and
 * returns `APPROVAL_ALREADY_DECIDED` before reaching this
 * dispatcher. Same guarantee as inbox / review-response.
 *
 * Audit `post.approved` (or `post.approved.edited`) is written by
 * the caller AFTER the txn commits — same audit-timing tradeoff
 * tracked at TODO.md#audit-events-atomicity.
 */

interface PostProposedPayload {
  kind: 'post';
  postId: string;
  scheduledAtIso: string | null;
  targetPlatforms?: ReadonlyArray<string>;
  campaignGoal?: string;
  approvalReason?: string;
  matchedPlatforms?: ReadonlyArray<string>;
  matchedCampaignGoal?: string;
  /**
   * Approve-with-edits override. When present, `posts.text` is
   * updated to this value before the status transition. Other
   * fields (link, utm, mediaIds, scheduledAt) remain editable on
   * the composer side; the modal does not surface them yet — that
   * lands in Phase 12 polish (TODO composer-edit-modal-post-kind).
   */
  editedText?: string;
}

export interface PostApprovalRow {
  id: string;
  organizationId: string;
  entityId: string;
  proposedPayload: unknown;
}

export interface DispatchPostApprovalResult {
  /** Post id whose status this dispatch transitioned. */
  postId: string;
  /** Either `'scheduled'` (deferred) or `'publishing'` (sync). */
  toStatus: PostStatus;
  /**
   * `true` when the caller (`approveAction`) should invoke
   * `runPublishTick()` AFTER the txn commits. The post is left in
   * `'publishing'` status with pending targets; Set B picks it up
   * in the same call and dispatches each target sync.
   */
  needsSyncDispatch: boolean;
  scheduledAtIso: string | null;
  /** `true` when the dispatch applied an `editedText` override. */
  textEdited: boolean;
}

function isPostProposedPayload(value: unknown): value is PostProposedPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.kind === 'post' && typeof v.postId === 'string';
}

export async function dispatchPostApproval(
  tx: AnyPgTx,
  approval: PostApprovalRow,
  _actorUserId: string,
): Promise<DispatchPostApprovalResult> {
  if (!isPostProposedPayload(approval.proposedPayload)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Approval ${approval.id} proposed_payload no es un payload de post válido.`,
      { meta: { approvalId: approval.id } },
    );
  }
  const payload = approval.proposedPayload;

  // Defense in depth: the post row must still exist + be in
  // 'pending_approval'. If a concurrent path already moved it
  // (e.g., schedulePostAction re-routed, or a sibling reject ran),
  // surface CONFLICT so the txn rolls back rather than blindly
  // overwriting the new state.
  const postRows = await tx
    .select({
      id: posts.id,
      status: posts.status,
      scheduledAt: posts.scheduledAt,
    })
    .from(posts)
    .where(
      and(
        eq(posts.id, payload.postId),
        eq(posts.organizationId, approval.organizationId),
      ),
    )
    .limit(1);
  if (postRows.length === 0) {
    throw new AppError(
      'NOT_FOUND',
      'El post de esta aprobación ya no existe.',
      { meta: { approvalId: approval.id, postId: payload.postId } },
    );
  }
  const post = postRows[0]!;
  const from = post.status as PostStatus;
  if (from !== 'pending_approval') {
    throw new AppError(
      'CONFLICT',
      `Este post ya no está pendiente de aprobación (estado actual: ${from}).`,
      { meta: { approvalId: approval.id, postId: post.id, status: from } },
    );
  }

  const toStatus: PostStatus =
    payload.scheduledAtIso === null ? 'publishing' : 'scheduled';
  if (!canTransition(from, toStatus)) {
    // State graph drift — should not happen given the gate above,
    // but the explicit check makes the failure mode legible.
    throw new AppError(
      'VALIDATION_ERROR',
      `Transición ${from} → ${toStatus} no permitida.`,
      { meta: { from, to: toStatus } },
    );
  }

  // approveWithEdits: apply the text override first. The editor
  // modal hands us the entire spread payload + the new `editedText`
  // field; only that field is honored. Other edits (link, utm,
  // schedule) are out of scope for the modal until Phase 12.
  let textEdited = false;
  if (typeof payload.editedText === 'string' && payload.editedText.length > 0) {
    await tx
      .update(posts)
      .set({ text: payload.editedText })
      .where(eq(posts.id, post.id));
    textEdited = true;
  }

  // Defensive `scheduled_at` update — if the approval payload
  // carries a different scheduled instant than the post row (e.g.
  // edit modal nudged it), persist that so the cron sees the
  // intended moment.
  const updates: Record<string, unknown> = { status: toStatus };
  if (payload.scheduledAtIso) {
    const parsed = new Date(payload.scheduledAtIso);
    if (!Number.isNaN(parsed.getTime())) {
      updates.scheduledAt = parsed;
    }
  }
  await tx.update(posts).set(updates).where(eq(posts.id, post.id));

  return {
    postId: post.id,
    toStatus,
    needsSyncDispatch: toStatus === 'publishing',
    scheduledAtIso: payload.scheduledAtIso,
    textEdited,
  };
}

/**
 * Reject path. Called by `rejectAction` AFTER it has locked the
 * approval row. Flips the post to `'cancelled'` so the calendar +
 * composer surfaces reflect the outcome. Targets stay where they
 * are — they were never dispatched, and `cancelled` is terminal.
 *
 * Idempotent: if the post is no longer in `pending_approval`, raise
 * CONFLICT instead of silently no-oping so the txn rolls back and
 * the approvals row doesn't drift to `rejected` against stale state.
 */
export async function dispatchPostRejection(
  tx: AnyPgTx,
  approval: PostApprovalRow,
): Promise<{ postId: string }> {
  if (!isPostProposedPayload(approval.proposedPayload)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Approval ${approval.id} proposed_payload no es un payload de post válido.`,
      { meta: { approvalId: approval.id } },
    );
  }
  const payload = approval.proposedPayload;

  const postRows = await tx
    .select({ id: posts.id, status: posts.status })
    .from(posts)
    .where(
      and(
        eq(posts.id, payload.postId),
        eq(posts.organizationId, approval.organizationId),
      ),
    )
    .limit(1);
  if (postRows.length === 0) {
    throw new AppError(
      'NOT_FOUND',
      'El post de esta aprobación ya no existe.',
      { meta: { approvalId: approval.id, postId: payload.postId } },
    );
  }
  const post = postRows[0]!;
  const from = post.status as PostStatus;
  if (from !== 'pending_approval') {
    throw new AppError(
      'CONFLICT',
      `Este post ya no está pendiente de aprobación (estado actual: ${from}).`,
      { meta: { approvalId: approval.id, postId: post.id, status: from } },
    );
  }
  if (!canTransition(from, 'cancelled')) {
    throw new AppError(
      'INTERNAL_ERROR',
      'pending_approval → cancelled transition disabled — state graph drift?',
    );
  }
  await tx.update(posts).set({ status: 'cancelled' }).where(eq(posts.id, post.id));
  return { postId: post.id };
}
