'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/server';
import {
  addCompetitorSchema,
  removeCompetitorSchema,
} from '@/lib/competitors/validate';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { auditEvents, competitors } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { requirePlanFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Competitor Server Actions (Phase 9 / Commit 34).
 */

export async function addCompetitorAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ competitorId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'competitors:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'competitors_tracking');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = addCompetitorSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos del competidor inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  const inserted = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .insert(competitors)
        .values({
          organizationId: session.orgId,
          ...(data.brandId ? { brandId: data.brandId } : {}),
          name: data.name,
          handles: data.handles ?? {},
          platforms: data.platforms,
          status: 'active',
        })
        .returning({ id: competitors.id }),
  );
  const competitorId = inserted[0]?.id;
  if (!competitorId) {
    return err('INTERNAL_ERROR', 'No se pudo crear el competidor.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'competitor.added',
        entityType: 'competitor',
        entityId: competitorId,
        after: {
          name: data.name,
          platforms: data.platforms,
          brandId: data.brandId ?? null,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit competitor.added.',
      { cause, meta: { competitorId } },
    );
  }

  revalidatePath('/competitors');
  return ok({ competitorId });
}

export async function removeCompetitorAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ competitorId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'competitors:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'competitors_tracking');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = removeCompetitorSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'competitorId inválido.');
  }

  const now = new Date();
  const updated = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .update(competitors)
        .set({ status: 'archived', archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(competitors.organizationId, session.orgId),
            eq(competitors.id, parsed.data.competitorId),
          ),
        )
        .returning({ id: competitors.id }),
  );
  if (updated.length === 0) {
    return err('NOT_FOUND', 'Competidor no encontrado.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'competitor.archived',
        entityType: 'competitor',
        entityId: parsed.data.competitorId,
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit competitor.archived.',
      { cause },
    );
  }

  revalidatePath('/competitors');
  return ok({ competitorId: parsed.data.competitorId });
}
