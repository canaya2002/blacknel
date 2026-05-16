'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import {
  dispatchApproved,
  dispatchRejection,
  type DispatchableApproval,
} from '@/lib/approvals/dispatch';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { approvals, auditEvents } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Server Actions backing the approval queue.
 *
 * Decisions go through three concurrency-safe gates inside ONE
 * `dbAs` transaction:
 *
 *   1. `SELECT ... FOR UPDATE` on the approval row. Locks it for the
 *      duration of the txn so a parallel moderator session blocks
 *      instead of double-dispatching.
 *   2. Status check. If the locked row isn't in `pending` /
 *      `escalated`, we return `APPROVAL_ALREADY_DECIDED` with the
 *      prior `decidedBy` + `decidedAt` so the UI can show "this was
 *      decided by X at Y" and refresh.
 *   3. For `approve` / `approveWithEdits`, dispatch the side effect
 *      via `dispatchApproved` BEFORE marking the row decided. If the
 *      dispatcher throws, the txn rolls back — the approval stays
 *      pending, no message is published, no double-send is possible.
 *
 * Audit events are written outside the transaction (via `dbAdmin`)
 * because `audit_events` writes are append-only and intentionally
 * outlive the decision txn — losing an audit row is annoying but
 * recoverable; double-dispatching is a real production bug.
 */

const approvalIdSchema = z.object({ approvalId: z.string().uuid() });

async function writeAudit(
  orgId: string,
  userId: string,
  action: string,
  approvalId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Promise<void> {
  await dbAdmin(async (tx) =>
    tx.insert(auditEvents).values({
      organizationId: orgId,
      userId,
      actorType: 'user',
      action,
      entityType: 'approval',
      entityId: approvalId,
      before,
      after,
    }),
  );
}

/** Sentinel returned by the txn body. The action wraps it in `Result`. */
type TxOutcome =
  | {
      kind: 'ok';
      messageId?: string;
      /** Phase-5 review-response dispatch products. */
      reviewResponseId?: string;
      reviewId?: string;
      /** Carries through the entity_table of the approval so audit emits the right event. */
      entityTable?: string;
    }
  | { kind: 'not_found' }
  | { kind: 'already_decided'; decidedBy: string | null; decidedAt: Date | null; status: string };

// ---------------------------------------------------------------------------
// approve — happy path approves + dispatches the side effect atomically
// ---------------------------------------------------------------------------

const approveSchema = z.object({
  approvalId: z.string().uuid(),
  decisionReason: z.string().max(1000).optional(),
});

export async function approveAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ approvalId: string; messageId?: string }>> {
  const session = await requireUser();
  authorize(session.role, 'approvals:decide');
  const parsed = approveSchema.safeParse({
    approvalId: formData.get('approvalId'),
    decisionReason: (formData.get('decisionReason') as string) || undefined,
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos.');

  let priorStatus: string | null = null;
  const outcome = await dbAs<TxOutcome>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      const lockedRows = await tx
        .select({
          id: approvals.id,
          organizationId: approvals.organizationId,
          kind: approvals.kind,
          entityTable: approvals.entityTable,
          entityId: approvals.entityId,
          status: approvals.status,
          decidedBy: approvals.decidedBy,
          decidedAt: approvals.decidedAt,
          proposedPayload: approvals.proposedPayload,
        })
        .from(approvals)
        .where(
          and(
            eq(approvals.id, parsed.data.approvalId),
            eq(approvals.organizationId, session.orgId),
          ),
        )
        .for('update')
        .limit(1);
      const row = lockedRows[0];
      if (!row) return { kind: 'not_found' };

      priorStatus = row.status;
      if (row.status !== 'pending' && row.status !== 'escalated') {
        return {
          kind: 'already_decided',
          decidedBy: row.decidedBy,
          decidedAt: row.decidedAt,
          status: row.status,
        };
      }

      // Dispatch the side effect inside the same txn. If it throws,
      // the outer await rejects, the txn rolls back, and the
      // approval stays pending.
      const dispatch = await dispatchApproved(
        tx,
        row as DispatchableApproval,
        session.userId,
      );

      await tx
        .update(approvals)
        .set({
          status: 'approved',
          decidedBy: session.userId,
          decidedAt: new Date(),
          ...(parsed.data.decisionReason
            ? { decisionReason: parsed.data.decisionReason }
            : {}),
        })
        .where(eq(approvals.id, row.id));

      const result: TxOutcome = { kind: 'ok', entityTable: row.entityTable };
      if (dispatch.messageId) {
        result.messageId = dispatch.messageId;
      }
      if (dispatch.reviewResponseId) {
        result.reviewResponseId = dispatch.reviewResponseId;
      }
      if (dispatch.reviewId) {
        result.reviewId = dispatch.reviewId;
      }
      return result;
    },
  );

  if (outcome.kind === 'not_found') {
    return err('NOT_FOUND', 'Approval no encontrada.');
  }
  if (outcome.kind === 'already_decided') {
    return err(
      'APPROVAL_ALREADY_DECIDED',
      'Esta aprobación ya fue decidida por otro usuario.',
      {
        meta: {
          decidedBy: outcome.decidedBy,
          decidedAt: outcome.decidedAt,
          status: outcome.status,
        },
      },
    );
  }
  const dispatchedMessageId = outcome.messageId;
  const dispatchedResponseId = outcome.reviewResponseId;
  const dispatchedReviewId = outcome.reviewId;

  // Audit. `approval.approved` always fires; the per-entity audit
  // emits afterward so observability dashboards can group by
  // entity_table.
  await writeAudit(
    session.orgId,
    session.userId,
    'approval.approved',
    parsed.data.approvalId,
    { status: priorStatus },
    {
      status: 'approved',
      decidedBy: session.userId,
      ...(parsed.data.decisionReason ? { decisionReason: parsed.data.decisionReason } : {}),
      ...(dispatchedMessageId ? { messageId: dispatchedMessageId } : {}),
      ...(dispatchedResponseId ? { reviewResponseId: dispatchedResponseId } : {}),
    },
  );
  if (dispatchedMessageId) {
    await writeAudit(
      session.orgId,
      session.userId,
      'inbox.reply.sent',
      dispatchedMessageId,
      null,
      { approvalId: parsed.data.approvalId, via: 'approval_dispatch' },
    );
  }
  if (dispatchedResponseId) {
    await writeAudit(
      session.orgId,
      session.userId,
      'review.response.published',
      dispatchedResponseId,
      null,
      {
        approvalId: parsed.data.approvalId,
        reviewId: dispatchedReviewId ?? null,
        via: 'approval_dispatch',
      },
    );
  }

  revalidatePath('/approvals');
  revalidatePath(`/approvals/${parsed.data.approvalId}`);
  if (dispatchedReviewId) {
    revalidatePath('/reviews');
    revalidatePath(`/reviews/${dispatchedReviewId}`);
  }
  return ok({
    approvalId: parsed.data.approvalId,
    ...(dispatchedMessageId ? { messageId: dispatchedMessageId } : {}),
  });
}

// ---------------------------------------------------------------------------
// approveWithEdits — same atomicity story; dispatch uses edited payload
// ---------------------------------------------------------------------------

const approveWithEditsSchema = z.object({
  approvalId: z.string().uuid(),
  editedPayload: z.record(z.string(), z.unknown()),
  decisionReason: z.string().max(1000).optional(),
});

export async function approveWithEditsAction(
  _prev: unknown,
  input: {
    approvalId: string;
    editedPayload: Record<string, unknown>;
    decisionReason?: string;
  },
): Promise<Result<{ approvalId: string; messageId?: string }>> {
  const session = await requireUser();
  authorize(session.role, 'approvals:decide');
  const parsed = approveWithEditsSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'Edición inválida.');

  let priorProposed: unknown = null;
  const outcome = await dbAs<TxOutcome>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      const lockedRows = await tx
        .select({
          id: approvals.id,
          organizationId: approvals.organizationId,
          kind: approvals.kind,
          entityTable: approvals.entityTable,
          entityId: approvals.entityId,
          status: approvals.status,
          decidedBy: approvals.decidedBy,
          decidedAt: approvals.decidedAt,
          proposed: approvals.proposedPayload,
        })
        .from(approvals)
        .where(
          and(
            eq(approvals.id, parsed.data.approvalId),
            eq(approvals.organizationId, session.orgId),
          ),
        )
        .for('update')
        .limit(1);
      const row = lockedRows[0];
      if (!row) return { kind: 'not_found' };

      if (row.status !== 'pending' && row.status !== 'escalated') {
        return {
          kind: 'already_decided',
          decidedBy: row.decidedBy,
          decidedAt: row.decidedAt,
          status: row.status,
        };
      }
      priorProposed = row.proposed;

      // Dispatch the EDITED payload, not the original proposal.
      const dispatch = await dispatchApproved(
        tx,
        {
          id: row.id,
          organizationId: row.organizationId,
          entityTable: row.entityTable,
          entityId: row.entityId,
          proposedPayload: parsed.data.editedPayload,
        },
        session.userId,
      );

      await tx
        .update(approvals)
        .set({
          status: 'edited_approved',
          originalPayload: row.proposed as object,
          proposedPayload: parsed.data.editedPayload,
          decidedBy: session.userId,
          decidedAt: new Date(),
          ...(parsed.data.decisionReason
            ? { decisionReason: parsed.data.decisionReason }
            : {}),
        })
        .where(eq(approvals.id, row.id));

      const result: TxOutcome = { kind: 'ok', entityTable: row.entityTable };
      if (dispatch.messageId) {
        result.messageId = dispatch.messageId;
      }
      if (dispatch.reviewResponseId) {
        result.reviewResponseId = dispatch.reviewResponseId;
      }
      if (dispatch.reviewId) {
        result.reviewId = dispatch.reviewId;
      }
      return result;
    },
  );

  if (outcome.kind === 'not_found') {
    return err('NOT_FOUND', 'Approval no encontrada.');
  }
  if (outcome.kind === 'already_decided') {
    return err(
      'APPROVAL_ALREADY_DECIDED',
      'Esta aprobación ya fue decidida por otro usuario.',
      {
        meta: {
          decidedBy: outcome.decidedBy,
          decidedAt: outcome.decidedAt,
          status: outcome.status,
        },
      },
    );
  }
  const dispatchedMessageId = outcome.messageId;
  const dispatchedResponseId = outcome.reviewResponseId;
  const dispatchedReviewId = outcome.reviewId;

  await writeAudit(
    session.orgId,
    session.userId,
    'approval.edit_approved',
    parsed.data.approvalId,
    { proposed: priorProposed as Record<string, unknown> },
    {
      status: 'edited_approved',
      decidedBy: session.userId,
      proposed: parsed.data.editedPayload,
      ...(parsed.data.decisionReason ? { decisionReason: parsed.data.decisionReason } : {}),
      ...(dispatchedMessageId ? { messageId: dispatchedMessageId } : {}),
      ...(dispatchedResponseId ? { reviewResponseId: dispatchedResponseId } : {}),
    },
  );
  if (dispatchedMessageId) {
    await writeAudit(
      session.orgId,
      session.userId,
      'inbox.reply.sent',
      dispatchedMessageId,
      null,
      {
        approvalId: parsed.data.approvalId,
        via: 'approval_dispatch_edited',
      },
    );
  }
  if (dispatchedResponseId) {
    await writeAudit(
      session.orgId,
      session.userId,
      'review.response.published',
      dispatchedResponseId,
      null,
      {
        approvalId: parsed.data.approvalId,
        reviewId: dispatchedReviewId ?? null,
        via: 'approval_dispatch_edited',
      },
    );
  }

  revalidatePath('/approvals');
  revalidatePath(`/approvals/${parsed.data.approvalId}`);
  if (dispatchedReviewId) {
    revalidatePath('/reviews');
    revalidatePath(`/reviews/${dispatchedReviewId}`);
  }
  return ok({
    approvalId: parsed.data.approvalId,
    ...(dispatchedMessageId ? { messageId: dispatchedMessageId } : {}),
  });
}

// ---------------------------------------------------------------------------
// reject — no dispatch; just status change + audit
// ---------------------------------------------------------------------------

const rejectSchema = z.object({
  approvalId: z.string().uuid(),
  decisionReason: z.string().min(1).max(1000),
});

export async function rejectAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ approvalId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'approvals:decide');
  const parsed = rejectSchema.safeParse({
    approvalId: formData.get('approvalId'),
    decisionReason: formData.get('decisionReason'),
  });
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Rechazo requiere razón explícita.');
  }

  const outcome = await dbAs<TxOutcome>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      const lockedRows = await tx
        .select({
          id: approvals.id,
          organizationId: approvals.organizationId,
          entityTable: approvals.entityTable,
          entityId: approvals.entityId,
          status: approvals.status,
          decidedBy: approvals.decidedBy,
          decidedAt: approvals.decidedAt,
          proposedPayload: approvals.proposedPayload,
        })
        .from(approvals)
        .where(
          and(
            eq(approvals.id, parsed.data.approvalId),
            eq(approvals.organizationId, session.orgId),
          ),
        )
        .for('update')
        .limit(1);
      const row = lockedRows[0];
      if (!row) return { kind: 'not_found' };
      if (row.status !== 'pending' && row.status !== 'escalated') {
        return {
          kind: 'already_decided',
          decidedBy: row.decidedBy,
          decidedAt: row.decidedAt,
          status: row.status,
        };
      }

      // Reject-side dispatch — for review_response approvals, flip the
      // child row to `rejected` so the composer surface reflects the
      // outcome. Inbox / posts don't need a side effect here.
      const dispatch = await dispatchRejection(tx, row as DispatchableApproval);

      await tx
        .update(approvals)
        .set({
          status: 'rejected',
          decidedBy: session.userId,
          decidedAt: new Date(),
          decisionReason: parsed.data.decisionReason,
        })
        .where(eq(approvals.id, row.id));

      const result: TxOutcome = { kind: 'ok', entityTable: row.entityTable };
      if (dispatch.reviewResponseId) {
        result.reviewResponseId = dispatch.reviewResponseId;
      }
      // Extract reviewId from proposed_payload for revalidation +
      // audit context. The dispatcher doesn't return it on reject.
      if (
        row.entityTable === 'review_responses' &&
        row.proposedPayload &&
        typeof row.proposedPayload === 'object' &&
        typeof (row.proposedPayload as { reviewId?: unknown }).reviewId === 'string'
      ) {
        result.reviewId = (row.proposedPayload as { reviewId: string }).reviewId;
      }
      return result;
    },
  );

  if (outcome.kind === 'not_found') {
    return err('NOT_FOUND', 'Approval no encontrada.');
  }
  if (outcome.kind === 'already_decided') {
    return err(
      'APPROVAL_ALREADY_DECIDED',
      'Esta aprobación ya fue decidida por otro usuario.',
      {
        meta: {
          decidedBy: outcome.decidedBy,
          decidedAt: outcome.decidedAt,
          status: outcome.status,
        },
      },
    );
  }

  await writeAudit(
    session.orgId,
    session.userId,
    'approval.rejected',
    parsed.data.approvalId,
    { status: 'pending' },
    {
      status: 'rejected',
      decisionReason: parsed.data.decisionReason,
      ...(outcome.reviewResponseId
        ? { reviewResponseId: outcome.reviewResponseId }
        : {}),
    },
  );
  if (outcome.reviewResponseId) {
    await writeAudit(
      session.orgId,
      session.userId,
      'review.response.rejected',
      outcome.reviewResponseId,
      null,
      {
        approvalId: parsed.data.approvalId,
        reviewId: outcome.reviewId ?? null,
        decisionReason: parsed.data.decisionReason,
      },
    );
  }

  revalidatePath('/approvals');
  revalidatePath(`/approvals/${parsed.data.approvalId}`);
  if (outcome.reviewId) {
    revalidatePath('/reviews');
    revalidatePath(`/reviews/${outcome.reviewId}`);
  }
  return ok({ approvalId: parsed.data.approvalId });
}

// ---------------------------------------------------------------------------
// escalate — moves pending -> escalated for re-routing in Phase 9
// ---------------------------------------------------------------------------

export async function escalateApprovalAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ approvalId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'approvals:decide');
  const parsed = approvalIdSchema.safeParse({ approvalId: formData.get('approvalId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  const outcome = await dbAs<TxOutcome>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      const lockedRows = await tx
        .select({
          id: approvals.id,
          status: approvals.status,
          decidedBy: approvals.decidedBy,
          decidedAt: approvals.decidedAt,
        })
        .from(approvals)
        .where(
          and(
            eq(approvals.id, parsed.data.approvalId),
            eq(approvals.organizationId, session.orgId),
          ),
        )
        .for('update')
        .limit(1);
      const row = lockedRows[0];
      if (!row) return { kind: 'not_found' };
      if (row.status !== 'pending') {
        return {
          kind: 'already_decided',
          decidedBy: row.decidedBy,
          decidedAt: row.decidedAt,
          status: row.status,
        };
      }
      await tx
        .update(approvals)
        .set({ status: 'escalated' })
        .where(eq(approvals.id, row.id));
      return { kind: 'ok' };
    },
  );

  if (outcome.kind === 'not_found') {
    return err('NOT_FOUND', 'Approval no encontrada.');
  }
  if (outcome.kind === 'already_decided') {
    return err(
      'APPROVAL_ALREADY_DECIDED',
      'Esta aprobación ya fue decidida por otro usuario.',
      {
        meta: {
          decidedBy: outcome.decidedBy,
          decidedAt: outcome.decidedAt,
          status: outcome.status,
        },
      },
    );
  }

  await writeAudit(
    session.orgId,
    session.userId,
    'approval.escalated',
    parsed.data.approvalId,
    { status: 'pending' },
    { status: 'escalated' },
  );

  revalidatePath('/approvals');
  revalidatePath(`/approvals/${parsed.data.approvalId}`);
  return ok({ approvalId: parsed.data.approvalId });
}

// Reference `sql` to keep the import alive when future predicates need it;
// the named-import linter rule is otherwise unhappy with unused imports.
void sql;

// Used by the existing inbox composer for guidance — silencing TS unused.
void AppError;
