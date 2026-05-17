'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import {
  countAuditEventsWithTx,
  searchAuditEventsWithTx,
} from '@/lib/audit-advanced/queries';
import {
  createRetentionPolicySchema,
  dismissAnomalySchema,
  exportAuditCsvSchema,
  removeRetentionPolicySchema,
} from '@/lib/audit-advanced/validate';
import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import {
  auditAnomalies,
  auditEvents,
  auditRetentionPolicies,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { assertPermissionInDb } from '@/lib/permissions/db-check';
import { authorize } from '@/lib/permissions/can';
import { requirePlanFeature } from '@/lib/plans/gates';
import { getPlan } from '@/lib/plans/plans';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Advanced Audit Server Actions (Phase 10 / Commit 37).
 *
 * Critical actions per `doc/PATTERNS.md#critical-actions`:
 *   - `exportAuditCsvAction` with `mass=true` → critical #6.
 *
 * Ajuste 3 — mass export blocks at row_count > MASS_EXPORT_MAX
 * BEFORE streaming. Audit event `audit.exported.blocked.too_large`
 * records the attempt.
 */

const MASS_EXPORT_MAX_ROWS = 100_000;

// ---------------------------------------------------------------------------
// exportAuditCsvAction
// ---------------------------------------------------------------------------

export interface AuditExportCsvSuccess {
  readonly csv: string;
  readonly filename: string;
  readonly rowCount: number;
  readonly sizeBytes: number;
}

export async function exportAuditCsvAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<AuditExportCsvSuccess>> {
  const session = await requireUser();
  authorize(session.role, 'audit:read');
  authorize(session.role, 'reports:export');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'audit_advanced');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = exportAuditCsvSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Parámetros de export inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  // Ajuste 3 — count first, block if > MASS_EXPORT_MAX_ROWS.
  const count = await dbAs<number>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      countAuditEventsWithTx(tx, session.orgId, {
        sinceDays: data.sinceDays,
        actionPrefix: data.actionPrefix ?? null,
        userId: data.userId ?? null,
      }),
  );

  if (count > MASS_EXPORT_MAX_ROWS) {
    // Audit the blocked attempt.
    try {
      await dbAdmin((tx) =>
        tx.insert(auditEvents).values({
          organizationId: session.orgId,
          userId: session.userId,
          actorType: 'user',
          action: 'audit.exported.blocked.too_large',
          entityType: 'audit_events',
          entityId: null,
          after: {
            requested_count: count,
            threshold: MASS_EXPORT_MAX_ROWS,
            filters: data,
          },
          riskLevel: 'medium',
        }),
      );
    } catch {
      // best-effort audit; do not surface internal error to user
    }
    return err(
      'VALIDATION_ERROR',
      `Demasiadas filas (${count.toLocaleString()}). Refiná filtros o pedí retention adjustment. Límite: ${MASS_EXPORT_MAX_ROWS.toLocaleString()}.`,
      { meta: { count, threshold: MASS_EXPORT_MAX_ROWS } },
    );
  }

  // For >1000 rows, mass=true must be explicit AND dual-enforced.
  if (count > 1000) {
    if (!data.mass) {
      return err(
        'VALIDATION_ERROR',
        `Export con más de 1000 filas requiere mass=true.`,
      );
    }
    try {
      await assertPermissionInDb(session, 'reports:export');
    } catch (e) {
      if (e instanceof AppError) return err(e);
      throw e;
    }
  }

  const rows = await dbAs(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      searchAuditEventsWithTx(
        tx,
        session.orgId,
        {
          sinceDays: data.sinceDays,
          actionPrefix: data.actionPrefix ?? null,
          userId: data.userId ?? null,
        },
        Math.min(count, MASS_EXPORT_MAX_ROWS),
      ),
  );

  const header: string[] = [
    'created_at',
    'action',
    'actor_email',
    'entity_type',
    'entity_id',
    'risk_level',
    'before',
    'after',
  ];
  const dataRows: string[][] = rows.map((r) => [
    r.createdAt.toISOString(),
    r.action,
    r.actorEmail ?? '',
    r.entityType ?? '',
    r.entityId ?? '',
    r.riskLevel ?? '',
    r.before === null ? '' : JSON.stringify(r.before),
    r.after === null ? '' : JSON.stringify(r.after),
  ]);
  const csv = [header, ...dataRows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');
  const sizeBytes = Buffer.byteLength(csv, 'utf8');
  const now = new Date();
  const filename = `blacknel-audit-${data.sinceDays}d-${now.toISOString().slice(0, 10)}.csv`;
  const rowCount = dataRows.length;

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'audit.exported',
        entityType: 'audit_events',
        entityId: null,
        after: {
          section: 'audit',
          sinceDays: data.sinceDays,
          actionPrefix: data.actionPrefix ?? null,
          userId: data.userId ?? null,
          mass: data.mass,
          rowCount,
          sizeBytes,
        },
        riskLevel: count > 1000 ? 'medium' : 'low',
      }),
    );
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Failed to audit audit.exported.', {
      cause,
    });
  }

  return ok({ csv, filename, rowCount, sizeBytes });
}

// ---------------------------------------------------------------------------
// createRetentionPolicyAction
// ---------------------------------------------------------------------------

export async function createRetentionPolicyAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ policyId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'audit:read');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'audit_advanced');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = createRetentionPolicySchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos del policy inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  // Per-plan retention cap.
  const cap = getPlan(plan).limits.auditRetentionDaysMax;
  if (cap > 0 && data.retentionDays > cap) {
    return err(
      'PLAN_LIMIT_REACHED',
      `Plan ${plan} permite retention máximo ${cap} días.`,
      { meta: { cap, requested: data.retentionDays } },
    );
  }

  const inserted = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .insert(auditRetentionPolicies)
        .values({
          organizationId: session.orgId,
          appliesTo: data.appliesTo,
          retentionDays: data.retentionDays,
          createdBy: session.userId,
        })
        .returning({ id: auditRetentionPolicies.id }),
  );
  const policyId = inserted[0]?.id;
  if (!policyId) {
    return err('INTERNAL_ERROR', 'No se pudo crear el policy.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'audit.retention.policy.created',
        entityType: 'audit_retention_policy',
        entityId: policyId,
        after: {
          appliesTo: data.appliesTo,
          retentionDays: data.retentionDays,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit audit.retention.policy.created.',
      { cause },
    );
  }

  revalidatePath('/audit/retention');
  return ok({ policyId });
}

// ---------------------------------------------------------------------------
// removeRetentionPolicyAction
// ---------------------------------------------------------------------------

export async function removeRetentionPolicyAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ policyId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'audit:read');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'audit_advanced');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = removeRetentionPolicySchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'policyId inválido.');
  }

  const deleted = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .delete(auditRetentionPolicies)
        .where(
          and(
            eq(auditRetentionPolicies.organizationId, session.orgId),
            eq(auditRetentionPolicies.id, parsed.data.policyId),
          ),
        )
        .returning({ id: auditRetentionPolicies.id }),
  );
  if (deleted.length === 0) {
    return err('NOT_FOUND', 'Policy no encontrado.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'audit.retention.policy.removed',
        entityType: 'audit_retention_policy',
        entityId: parsed.data.policyId,
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit audit.retention.policy.removed.',
      { cause },
    );
  }

  revalidatePath('/audit/retention');
  return ok({ policyId: parsed.data.policyId });
}

// ---------------------------------------------------------------------------
// dismissAnomalyAction (Ajuste 1 — reason required)
// ---------------------------------------------------------------------------

export async function dismissAnomalyAction(
  _prev: unknown,
  input: unknown,
): Promise<
  Result<{
    anomalyId: string;
    status: 'dismissed' | 'accepted';
  }>
> {
  const session = await requireUser();
  authorize(session.role, 'audit:read');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'audit_advanced');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = dismissAnomalySchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Reason requerido (≥10 chars).', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const { anomalyId, action, reason } = parsed.data;
  const status: 'dismissed' | 'accepted' =
    action === 'accept' ? 'accepted' : 'dismissed';

  const now = new Date();
  const updated = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .update(auditAnomalies)
        .set({
          status,
          decidedAt: now,
          decidedBy: session.userId,
          decidedReason: reason,
        })
        .where(
          and(
            eq(auditAnomalies.organizationId, session.orgId),
            eq(auditAnomalies.id, anomalyId),
            eq(auditAnomalies.status, 'pending'),
          ),
        )
        .returning({ id: auditAnomalies.id }),
  );
  if (updated.length === 0) {
    return err('NOT_FOUND', 'Anomalía no encontrada (o ya decidida).');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: `audit_anomaly.${status}`,
        entityType: 'audit_anomaly',
        entityId: anomalyId,
        after: { status, reason },
        riskLevel: 'medium',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      `Failed to audit audit_anomaly.${status}.`,
      { cause },
    );
  }

  revalidatePath('/audit/anomalies');
  return ok({ anomalyId, status });
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
