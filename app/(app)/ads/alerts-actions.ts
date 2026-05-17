'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import {
  acceptAdsAlertSchema,
  dismissAdsAlertSchema,
} from '@/lib/ads/validate';
import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { adsAlerts, auditEvents } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * /ads alert decision actions (Phase 8 / Commit 29).
 *
 * `pending → accepted | dismissed` (terminal). Re-deciding a
 * terminal row returns `CONFLICT`. Audits:
 *   - `ads_alert.accepted`
 *   - `ads_alert.dismissed` (with `before.severity` + `after.reason`)
 *
 * Same `requireUser` + `authorize` + read-prior + UPDATE + audit
 * pattern as Phase 6/7. Audit failure raises INTERNAL_ERROR so
 * state and audit never diverge silently.
 */

export async function acceptAdsAlertAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ alertId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'ads_alerts:decide');

  const parsed = acceptAdsAlertSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'Solicitud inválida.');
  const { alertId } = parsed.data;

  const prior = await dbAs<
    Array<{
      status: 'pending' | 'accepted' | 'dismissed';
      severity: 'low' | 'medium' | 'high' | 'critical';
      kind: 'ctr_drop' | 'spend_spike' | 'account_error' | 'budget_anomaly_reserved';
    }>
  >({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .select({
        status: adsAlerts.status,
        severity: adsAlerts.severity,
        kind: adsAlerts.kind,
      })
      .from(adsAlerts)
      .where(
        and(
          eq(adsAlerts.id, alertId),
          eq(adsAlerts.organizationId, session.orgId),
        ),
      )
      .limit(1),
  );
  if (prior.length === 0) return err('NOT_FOUND', 'Alerta no encontrada.');
  if (prior[0]!.status !== 'pending') {
    return err('CONFLICT', 'La alerta ya tiene una decisión registrada.');
  }

  await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(adsAlerts)
      .set({
        status: 'accepted',
        decidedAt: new Date(),
        decidedBy: session.userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(adsAlerts.id, alertId),
          eq(adsAlerts.organizationId, session.orgId),
        ),
      ),
  );

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'ads_alert.accepted',
        entityType: 'ads_alert',
        entityId: alertId,
        before: { status: 'pending', severity: prior[0]!.severity },
        after: { status: 'accepted', kind: prior[0]!.kind },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to write ads_alert.accepted audit.',
      { cause, meta: { alertId } },
    );
  }

  revalidatePath('/ads');
  return ok({ alertId });
}

export async function dismissAdsAlertAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ alertId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'ads_alerts:decide');

  const parsed = dismissAdsAlertSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Razón de descarte requerida.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const { alertId, reason } = parsed.data;

  const prior = await dbAs<
    Array<{
      status: 'pending' | 'accepted' | 'dismissed';
      severity: 'low' | 'medium' | 'high' | 'critical';
      kind: 'ctr_drop' | 'spend_spike' | 'account_error' | 'budget_anomaly_reserved';
    }>
  >({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .select({
        status: adsAlerts.status,
        severity: adsAlerts.severity,
        kind: adsAlerts.kind,
      })
      .from(adsAlerts)
      .where(
        and(
          eq(adsAlerts.id, alertId),
          eq(adsAlerts.organizationId, session.orgId),
        ),
      )
      .limit(1),
  );
  if (prior.length === 0) return err('NOT_FOUND', 'Alerta no encontrada.');
  if (prior[0]!.status !== 'pending') {
    return err('CONFLICT', 'La alerta ya tiene una decisión registrada.');
  }

  await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(adsAlerts)
      .set({
        status: 'dismissed',
        decidedAt: new Date(),
        decidedBy: session.userId,
        decidedReason: reason,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(adsAlerts.id, alertId),
          eq(adsAlerts.organizationId, session.orgId),
        ),
      ),
  );

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'ads_alert.dismissed',
        entityType: 'ads_alert',
        entityId: alertId,
        before: { status: 'pending', severity: prior[0]!.severity },
        after: { status: 'dismissed', reason, kind: prior[0]!.kind },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to write ads_alert.dismissed audit.',
      { cause, meta: { alertId } },
    );
  }

  revalidatePath('/ads');
  return ok({ alertId });
}
