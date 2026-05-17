'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { aiRecommendations, auditEvents } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Server Actions for crisis recommendations (Phase 7 / Commit 25).
 *
 * Two terminal decisions:
 *   - `acceptCrisisAction`  → status='accepted', audit, refresh banner.
 *   - `dismissCrisisAction` → status='dismissed' + reason, audit.
 *
 * Both gated by `crisis:decide` (manager+). Concurrent decisions
 * race on a SELECT FOR UPDATE; the second receives CONFLICT with
 * the decided-by / decided-at metadata mirroring the approvals
 * pattern.
 */

const acceptSchema = z.object({
  recommendationId: z.string().uuid(),
});

const dismissSchema = z.object({
  recommendationId: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
});

type TxOutcome =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | {
      kind: 'already_decided';
      status: string;
      decidedBy: string | null;
      decidedAt: Date | null;
    };

export async function acceptCrisisAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ recommendationId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'crisis:decide');

  const parsed = acceptSchema.safeParse({
    recommendationId: formData.get('recommendationId'),
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  const outcome = await dbAs<TxOutcome>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      const lockedRows = await tx
        .select({
          id: aiRecommendations.id,
          status: aiRecommendations.status,
          decidedBy: aiRecommendations.decidedBy,
          decidedAt: aiRecommendations.decidedAt,
        })
        .from(aiRecommendations)
        .where(
          and(
            eq(aiRecommendations.id, parsed.data.recommendationId),
            eq(aiRecommendations.organizationId, session.orgId),
            eq(aiRecommendations.category, 'crisis'),
          ),
        )
        .for('update')
        .limit(1);
      const row = lockedRows[0];
      if (!row) return { kind: 'not_found' };
      if (row.status !== 'pending') {
        return {
          kind: 'already_decided',
          status: row.status,
          decidedBy: row.decidedBy,
          decidedAt: row.decidedAt,
        };
      }
      await tx
        .update(aiRecommendations)
        .set({
          status: 'accepted',
          decidedAt: new Date(),
          decidedBy: session.userId,
        })
        .where(eq(aiRecommendations.id, row.id));
      return { kind: 'ok' };
    },
  );

  if (outcome.kind === 'not_found') {
    return err('NOT_FOUND', 'Recomendación de crisis no encontrada.');
  }
  if (outcome.kind === 'already_decided') {
    return err(
      'CONFLICT',
      'Esta recomendación ya fue decidida.',
      {
        meta: {
          status: outcome.status,
          decidedBy: outcome.decidedBy,
          decidedAt: outcome.decidedAt,
        },
      },
    );
  }

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'ai_recommendation.crisis.accepted',
        entityType: 'ai_recommendation',
        entityId: parsed.data.recommendationId,
        before: { status: 'pending' },
        after: { status: 'accepted' },
        riskLevel: 'medium',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit ai_recommendation.crisis.accepted.',
      { cause, meta: { recommendationId: parsed.data.recommendationId } },
    );
  }

  revalidatePath('/reputation');
  revalidatePath('/reputation/crisis/history');
  return ok({ recommendationId: parsed.data.recommendationId });
}

export async function dismissCrisisAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ recommendationId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'crisis:decide');

  const parsed = dismissSchema.safeParse({
    recommendationId: formData.get('recommendationId'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return err(
      'VALIDATION_ERROR',
      'Una razón clara es requerida para descartar la crisis.',
    );
  }

  const outcome = await dbAs<TxOutcome>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      const lockedRows = await tx
        .select({
          id: aiRecommendations.id,
          status: aiRecommendations.status,
          decidedBy: aiRecommendations.decidedBy,
          decidedAt: aiRecommendations.decidedAt,
        })
        .from(aiRecommendations)
        .where(
          and(
            eq(aiRecommendations.id, parsed.data.recommendationId),
            eq(aiRecommendations.organizationId, session.orgId),
            eq(aiRecommendations.category, 'crisis'),
          ),
        )
        .for('update')
        .limit(1);
      const row = lockedRows[0];
      if (!row) return { kind: 'not_found' };
      if (row.status !== 'pending') {
        return {
          kind: 'already_decided',
          status: row.status,
          decidedBy: row.decidedBy,
          decidedAt: row.decidedAt,
        };
      }
      // The reason lives in evidence.decisionReason — the rec
      // table has no dedicated `decision_reason` column. Patch
      // jsonb in place via `jsonb_set`.
      await tx
        .update(aiRecommendations)
        .set({
          status: 'dismissed',
          decidedAt: new Date(),
          decidedBy: session.userId,
          evidence: sql`jsonb_set(${aiRecommendations.evidence}, '{decisionReason}', ${JSON.stringify(parsed.data.reason)}::jsonb)`,
        })
        .where(eq(aiRecommendations.id, row.id));
      return { kind: 'ok' };
    },
  );

  if (outcome.kind === 'not_found') {
    return err('NOT_FOUND', 'Recomendación de crisis no encontrada.');
  }
  if (outcome.kind === 'already_decided') {
    return err(
      'CONFLICT',
      'Esta recomendación ya fue decidida.',
      {
        meta: {
          status: outcome.status,
          decidedBy: outcome.decidedBy,
          decidedAt: outcome.decidedAt,
        },
      },
    );
  }

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'ai_recommendation.crisis.dismissed',
        entityType: 'ai_recommendation',
        entityId: parsed.data.recommendationId,
        before: { status: 'pending' },
        after: { status: 'dismissed', reason: parsed.data.reason },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit ai_recommendation.crisis.dismissed.',
      { cause, meta: { recommendationId: parsed.data.recommendationId } },
    );
  }

  revalidatePath('/reputation');
  revalidatePath('/reputation/crisis/history');
  return ok({ recommendationId: parsed.data.recommendationId });
}
