'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { getOrgPlanCode } from '@/lib/queries/plan';
import {
  cancelReviewRequest,
  sendReviewRequest,
  sendReviewRequestsBulk,
  type BulkSendSummary,
  type SendRequestSuccess,
} from '@/lib/reviews/send-request';
import { err, type Result } from '@/lib/types/result';

/**
 * Server Actions for /reviews/requests. Each one validates input
 * with Zod, runs the org-plan lookup, and hands off to the
 * orchestrator. Same shape as the Commit 14 review-response actions.
 */

// ---------------------------------------------------------------------------
// Single send
// ---------------------------------------------------------------------------

const singleSchema = z.object({
  brandId: z.string().uuid(),
  locationId: z.string().uuid(),
  email: z.string().email().max(254),
  name: z.string().min(1).max(120).optional(),
});

export async function createReviewRequestAction(
  _prev: unknown,
  input: z.infer<typeof singleSchema>,
): Promise<Result<SendRequestSuccess>> {
  const session = await requireUser();
  authorize(session.role, 'reviews:reply');

  const parsed = singleSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos.');

  const plan = await getOrgPlanCode(session);
  const result = await sendReviewRequest(
    { orgId: session.orgId, userId: session.userId, plan },
    {
      brandId: parsed.data.brandId,
      locationId: parsed.data.locationId,
      recipient: {
        email: parsed.data.email,
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
      },
    },
  );

  if (result.ok) {
    revalidatePath('/reviews/requests');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Bulk send
// ---------------------------------------------------------------------------

const bulkSchema = z.object({
  brandId: z.string().uuid(),
  locationId: z.string().uuid(),
  recipients: z
    .array(
      z.object({
        email: z.string().email().max(254),
        name: z.string().min(1).max(120).optional(),
      }),
    )
    .min(1)
    .max(200),
});

export async function bulkSendReviewRequestsAction(
  _prev: unknown,
  input: z.infer<typeof bulkSchema>,
): Promise<Result<BulkSendSummary>> {
  const session = await requireUser();
  authorize(session.role, 'reviews:reply');

  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos.');

  const plan = await getOrgPlanCode(session);
  const result = await sendReviewRequestsBulk(
    { orgId: session.orgId, userId: session.userId, plan },
    {
      brandId: parsed.data.brandId,
      locationId: parsed.data.locationId,
      recipients: parsed.data.recipients,
    },
  );

  if (result.ok) {
    revalidatePath('/reviews/requests');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

const cancelSchema = z.object({ requestId: z.string().uuid() });

export async function cancelReviewRequestAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ requestId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'reviews:reply');
  const parsed = cancelSchema.safeParse({ requestId: formData.get('requestId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  const result = await cancelReviewRequest(
    { orgId: session.orgId, userId: session.userId },
    parsed.data.requestId,
  );
  if (result.ok) {
    revalidatePath('/reviews/requests');
  }
  return result;
}
