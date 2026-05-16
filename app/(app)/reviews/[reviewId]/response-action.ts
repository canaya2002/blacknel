'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import {
  sendReviewResponse,
  type SendResponseSuccess,
} from '@/lib/reviews/send-response';
import { err, type Result } from '@/lib/types/result';

/**
 * Server Action wrapping `sendReviewResponse`. Same shape as
 * `app/(app)/inbox/[threadId]/reply-action.ts` (Commit 9): auth +
 * RBAC + Zod, then revalidate the affected paths after a successful
 * outcome. The orchestrator does the heavy lifting (compliance,
 * routing, audit).
 */
const inputSchema = z.object({
  reviewId: z.string().uuid(),
  body: z.string().min(1).max(4000),
  aiGenerated: z.boolean().optional(),
  mode: z.enum(['draft', 'send']),
  idempotencyKey: z.string().uuid().optional(),
});

export type ResponseActionInput = z.infer<typeof inputSchema>;

export async function respondToReviewAction(
  _prev: unknown,
  input: ResponseActionInput,
): Promise<Result<SendResponseSuccess>> {
  const session = await requireUser();
  authorize(session.role, 'reviews:reply');

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos de respuesta inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  const sendInput = {
    reviewId: parsed.data.reviewId,
    body: parsed.data.body,
    mode: parsed.data.mode,
    ...(parsed.data.aiGenerated !== undefined
      ? { aiGenerated: parsed.data.aiGenerated }
      : {}),
    ...(parsed.data.idempotencyKey !== undefined
      ? { idempotencyKey: parsed.data.idempotencyKey }
      : {}),
  };

  const result = await sendReviewResponse(
    { orgId: session.orgId, userId: session.userId },
    sendInput,
  );
  if (!result.ok) return result;

  revalidatePath('/reviews');
  revalidatePath(`/reviews/${parsed.data.reviewId}`);
  if (result.data.outcome === 'routed_to_approval') {
    revalidatePath('/approvals');
  }
  return { ok: true, data: result.data };
}
