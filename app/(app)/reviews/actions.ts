'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { auditEvents, reviewStatusEnum, reviews } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Server Actions for the public-review surface. CRUD on the review
 * row itself — composer / draft / send live in Commit 14.
 *
 * Each action follows the inbox pattern (Commit 7):
 *
 *   1. requireUser() → UNAUTHORIZED if no session.
 *   2. authorize(role, permission) → FORBIDDEN if RBAC fails.
 *   3. Zod parse.
 *   4. dbAs() RLS-enforced UPDATE.
 *   5. dbAdmin() audit row.
 *   6. revalidatePath().
 */

const reviewIdSchema = z.object({ reviewId: z.string().uuid() });

async function writeAudit(
  orgId: string,
  userId: string,
  action: string,
  reviewId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Promise<void> {
  await dbAdmin(async (tx) =>
    tx.insert(auditEvents).values({
      organizationId: orgId,
      userId,
      actorType: 'user',
      action,
      entityType: 'review',
      entityId: reviewId,
      before,
      after,
    }),
  );
}

// ---------------------------------------------------------------------------
// assign / unassign
// ---------------------------------------------------------------------------

const assignSchema = z.object({
  reviewId: z.string().uuid(),
  assigneeUserId: z.string().uuid().nullable(),
});

export async function assignReviewAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ reviewId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'reviews:reply');

  const rawAssignee = formData.get('assigneeUserId');
  const parsed = assignSchema.safeParse({
    reviewId: formData.get('reviewId'),
    assigneeUserId:
      typeof rawAssignee === 'string' && rawAssignee.length > 0 ? rawAssignee : null,
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos para asignar.');

  const before = await dbAs<Array<{ assignedTo: string | null }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({ assignedTo: reviews.assignedTo })
        .from(reviews)
        .where(
          and(eq(reviews.id, parsed.data.reviewId), eq(reviews.organizationId, session.orgId)),
        )
        .limit(1),
  );
  if (before.length === 0) return err('NOT_FOUND', 'Review no encontrada.');

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(reviews)
        .set({
          assignedTo: parsed.data.assigneeUserId,
          status: parsed.data.assigneeUserId ? 'in_progress' : 'pending',
        })
        .where(
          and(eq(reviews.id, parsed.data.reviewId), eq(reviews.organizationId, session.orgId)),
        ),
  );

  await writeAudit(
    session.orgId,
    session.userId,
    'review.assigned',
    parsed.data.reviewId,
    { assignedTo: before[0]!.assignedTo },
    { assignedTo: parsed.data.assigneeUserId },
  );

  revalidatePath('/reviews');
  revalidatePath(`/reviews/${parsed.data.reviewId}`);
  return ok({ reviewId: parsed.data.reviewId });
}

// ---------------------------------------------------------------------------
// escalate (sets escalated=true + audits)
// ---------------------------------------------------------------------------

export async function escalateReviewAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ reviewId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'reviews:reply');
  const parsed = reviewIdSchema.safeParse({ reviewId: formData.get('reviewId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  const before = await dbAs<Array<{ escalated: boolean }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({ escalated: reviews.escalated })
        .from(reviews)
        .where(
          and(eq(reviews.id, parsed.data.reviewId), eq(reviews.organizationId, session.orgId)),
        )
        .limit(1),
  );
  if (before.length === 0) return err('NOT_FOUND', 'Review no encontrada.');

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(reviews)
        .set({ escalated: true })
        .where(
          and(eq(reviews.id, parsed.data.reviewId), eq(reviews.organizationId, session.orgId)),
        ),
  );

  await writeAudit(
    session.orgId,
    session.userId,
    'review.escalated',
    parsed.data.reviewId,
    { escalated: before[0]!.escalated },
    { escalated: true },
  );

  revalidatePath('/reviews');
  revalidatePath(`/reviews/${parsed.data.reviewId}`);
  return ok({ reviewId: parsed.data.reviewId });
}

// ---------------------------------------------------------------------------
// markSpam → terminal status
// ---------------------------------------------------------------------------

export async function markReviewSpamAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ reviewId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'reviews:reply');
  const parsed = reviewIdSchema.safeParse({ reviewId: formData.get('reviewId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  const result = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(reviews)
        .set({ status: 'spam' })
        .where(
          and(eq(reviews.id, parsed.data.reviewId), eq(reviews.organizationId, session.orgId)),
        )
        .returning({ id: reviews.id }),
  );
  if (result.length === 0) return err('NOT_FOUND', 'Review no encontrada.');

  await writeAudit(
    session.orgId,
    session.userId,
    'review.marked_spam',
    parsed.data.reviewId,
    null,
    { status: 'spam' },
  );

  revalidatePath('/reviews');
  revalidatePath(`/reviews/${parsed.data.reviewId}`);
  return ok({ reviewId: parsed.data.reviewId });
}

// ---------------------------------------------------------------------------
// changeStatus (limited to safe transitions)
// ---------------------------------------------------------------------------

const statusSchema = z.object({
  reviewId: z.string().uuid(),
  status: z.enum(reviewStatusEnum.enumValues),
});

export async function changeReviewStatusAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ reviewId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'reviews:reply');
  const parsed = statusSchema.safeParse({
    reviewId: formData.get('reviewId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Estado inválido.');

  const before = await dbAs<Array<{ status: string }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({ status: reviews.status })
        .from(reviews)
        .where(
          and(eq(reviews.id, parsed.data.reviewId), eq(reviews.organizationId, session.orgId)),
        )
        .limit(1),
  );
  if (before.length === 0) return err('NOT_FOUND', 'Review no encontrada.');

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(reviews)
        .set({ status: parsed.data.status })
        .where(
          and(eq(reviews.id, parsed.data.reviewId), eq(reviews.organizationId, session.orgId)),
        ),
  );

  await writeAudit(
    session.orgId,
    session.userId,
    'review.status_changed',
    parsed.data.reviewId,
    { status: before[0]!.status },
    { status: parsed.data.status },
  );

  revalidatePath('/reviews');
  revalidatePath(`/reviews/${parsed.data.reviewId}`);
  return ok({ reviewId: parsed.data.reviewId });
}

// ---------------------------------------------------------------------------
// tags — same pattern as inbox tags (jsonb set semantics)
// ---------------------------------------------------------------------------

const tagSchema = z.object({
  reviewId: z.string().uuid(),
  tag: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/i, 'Tag inválido.'),
});

export async function addReviewTagAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ reviewId: string; tag: string }>> {
  const session = await requireUser();
  authorize(session.role, 'reviews:reply');
  const parsed = tagSchema.safeParse({
    reviewId: formData.get('reviewId'),
    tag: formData.get('tag'),
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos.');

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(reviews)
        .set({
          tags: sql`CASE
            WHEN ${reviews.tags} @> ${JSON.stringify([parsed.data.tag])}::jsonb THEN ${reviews.tags}
            ELSE ${reviews.tags} || ${JSON.stringify([parsed.data.tag])}::jsonb
          END`,
        })
        .where(
          and(eq(reviews.id, parsed.data.reviewId), eq(reviews.organizationId, session.orgId)),
        ),
  );

  revalidatePath('/reviews');
  revalidatePath(`/reviews/${parsed.data.reviewId}`);
  return ok({ reviewId: parsed.data.reviewId, tag: parsed.data.tag });
}

export async function removeReviewTagAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ reviewId: string; tag: string }>> {
  const session = await requireUser();
  authorize(session.role, 'reviews:reply');
  const parsed = tagSchema.safeParse({
    reviewId: formData.get('reviewId'),
    tag: formData.get('tag'),
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos.');

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(reviews)
        .set({
          tags: sql`(
            SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
            FROM jsonb_array_elements_text(${reviews.tags}) AS t
            WHERE t <> ${parsed.data.tag}
          )`,
        })
        .where(
          and(eq(reviews.id, parsed.data.reviewId), eq(reviews.organizationId, session.orgId)),
        ),
  );

  revalidatePath('/reviews');
  revalidatePath(`/reviews/${parsed.data.reviewId}`);
  return ok({ reviewId: parsed.data.reviewId, tag: parsed.data.tag });
}

// Keep `AppError` import live for future actions in Commit 14.
void AppError;
