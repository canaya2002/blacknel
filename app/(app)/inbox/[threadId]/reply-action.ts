'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { type DetectedLanguage, SUPPORTED_LANGUAGES } from '@/lib/inbox/detect-language';
import { sendReplyToThread } from '@/lib/inbox/send-reply';
import { authorize } from '@/lib/permissions/can';
import { err, type Result } from '@/lib/types/result';

/**
 * Outbound reply Server Action. Wraps `sendReplyToThread` with the
 * request preamble (auth + RBAC + Zod) and revalidates the affected
 * paths after a successful send / approval routing.
 *
 * Per the master prompt's "one server action per file" rule for
 * actions with >3 side-effects, this lives in its own module — the
 * orchestrator inside `lib/inbox/send-reply.ts` touches DB, compliance,
 * approvals and audit, plus this action mutates the cache.
 */

const inputSchema = z.object({
  threadId: z.string().uuid(),
  messageBody: z.string().min(1).max(8000),
  savedReplyId: z.string().uuid().nullable().optional(),
  aiGenerated: z.boolean().optional(),
  language: z
    .enum([...SUPPORTED_LANGUAGES, 'unknown'] as [
      DetectedLanguage,
      ...DetectedLanguage[],
    ])
    .optional(),
});

export interface ReplyActionResult {
  outcome: 'sent' | 'routed_to_approval';
  messageId?: string;
  approvalId?: string;
}

export async function replyAction(
  _prev: unknown,
  input: {
    threadId: string;
    messageBody: string;
    savedReplyId?: string | null;
    aiGenerated?: boolean;
    language?: DetectedLanguage;
  },
): Promise<Result<ReplyActionResult>> {
  const session = await requireUser();
  authorize(session.role, 'inbox:reply');

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos del mensaje inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  const sendInput = {
    threadId: parsed.data.threadId,
    messageBody: parsed.data.messageBody,
    ...(parsed.data.savedReplyId !== undefined
      ? { savedReplyId: parsed.data.savedReplyId }
      : {}),
    ...(parsed.data.aiGenerated !== undefined
      ? { aiGenerated: parsed.data.aiGenerated }
      : {}),
    ...(parsed.data.language !== undefined ? { language: parsed.data.language } : {}),
  };

  const result = await sendReplyToThread(
    { orgId: session.orgId, userId: session.userId },
    sendInput,
  );
  if (!result.ok) return result;

  revalidatePath('/inbox');
  revalidatePath(`/inbox/${parsed.data.threadId}`);
  if (result.data.outcome === 'routed_to_approval') {
    revalidatePath('/approvals');
  }
  return { ok: true, data: result.data };
}
