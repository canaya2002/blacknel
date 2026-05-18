'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/server';
import { countCustomReportsByOrgWithTx } from '@/lib/custom-reports/queries';
import { TEMPLATES, type TemplateId } from '@/lib/custom-reports/templates';
import {
  addWidgetSchema,
  archiveCustomReportSchema,
  createCustomReportSchema,
  exportCustomReportHtmlSchema,
  moveWidgetSchema,
  publishCustomReportSchema,
  removeWidgetSchema,
  shareCustomReportSchema,
  updateCustomReportSchema,
  updateWidgetConfigSchema,
  validateWidgetConfig,
} from '@/lib/custom-reports/validate';
import { validateLayout } from '@/lib/custom-reports/layout-validate';
import { dbAdmin, dbAs } from '@/lib/db/client';
import {
  auditEvents,
  customReportWidgets,
  customReports,
  type CustomReport,
  type CustomReportWidget,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { assertPermissionInDb } from '@/lib/permissions/db-check';
import { requirePlanFeature } from '@/lib/plans/gates';
import { getPlan } from '@/lib/plans/plans';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { err, ok, type Result } from '@/lib/types/result';
import { runCustomReport } from '@/lib/custom-reports/run';

/**
 * Phase 10 / Commit 39 — Custom Report Builder Server Actions.
 *
 * # Guard order (consistent across actions)
 *
 *   1. `requireUser()` — auth.
 *   2. `authorize(role, 'custom_reports:write')` — TS RBAC.
 *   3. `requirePlanFeature(plan, 'custom_reports')` — plan gate.
 *   4. `assertPermissionInDb(session, 'custom_reports:write')`
 *      — DB cross-check (the 11th critical action joins the
 *      C36a/C36b dual-enforcement family).
 *   5. Zod parse.
 *   6. Body work.
 *   7. Audit (status transitions ONLY — D-39-10 a).
 *
 * # Audit cadence (D-39-10 a)
 *
 * Status transitions emit `custom_report.created`,
 * `custom_report.published`, `custom_report.archived`,
 * `custom_report.shared`. Layout / widget config updates do NOT
 * emit audit (would spam the trail).
 */

const CUSTOM_REPORTS_WRITE = 'custom_reports:write' as const;

async function guardWrite(): Promise<
  | {
      readonly ok: true;
      readonly session: Awaited<ReturnType<typeof requireUser>>;
      readonly plan: Awaited<ReturnType<typeof getOrgPlanCode>>;
    }
  | { readonly ok: false; readonly error: AppError }
> {
  const session = await requireUser();
  try {
    authorize(session.role, CUSTOM_REPORTS_WRITE);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e };
    throw e;
  }
  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'custom_reports');
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e };
    throw e;
  }
  try {
    await assertPermissionInDb(session, CUSTOM_REPORTS_WRITE);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e };
    throw e;
  }
  return { ok: true, session, plan };
}

async function assertReportWritable(
  session: { orgId: string; userId: string },
  reportId: string,
): Promise<CustomReport | AppError> {
  const rows = await dbAs<CustomReport[]>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select()
        .from(customReports)
        .where(
          and(
            eq(customReports.organizationId, session.orgId),
            eq(customReports.id, reportId),
          ),
        )
        .limit(1),
  );
  if (rows.length === 0) {
    return new AppError('NOT_FOUND', 'Custom report not found.', {
      meta: { reportId },
    });
  }
  const report = rows[0]!;
  if (report.status === 'archived') {
    return new AppError(
      'VALIDATION_ERROR',
      'Custom report is archived. Restore before editing.',
      { meta: { reportId } },
    );
  }
  return report;
}

// ---------------------------------------------------------------------------
// createCustomReportAction
// ---------------------------------------------------------------------------

export async function createCustomReportAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ reportId: string }>> {
  const guard = await guardWrite();
  if (!guard.ok) return err(guard.error);

  const parsed = createCustomReportSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos del reporte inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  // Cap enforcement.
  const cap = getPlan(guard.plan).limits.maxCustomReportsPerOrg;
  const currentCount = await dbAs<number>(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) => countCustomReportsByOrgWithTx(tx, { orgId: guard.session.orgId }),
  );
  if (cap >= 0 && currentCount >= cap) {
    return err(
      'PLAN_LIMIT_REACHED',
      `Plan ${guard.plan} permite máximo ${cap} custom reports. Tenés ${currentCount}.`,
      { meta: { cap, currentCount, plan: guard.plan } },
    );
  }

  const inserted = await dbAs<Array<{ id: string }>>(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .insert(customReports)
        .values({
          organizationId: guard.session.orgId,
          name: data.name,
          ...(data.description ? { description: data.description } : {}),
          ...(data.brandId ? { brandId: data.brandId } : {}),
          status: 'draft',
          createdBy: guard.session.userId,
        })
        .returning({ id: customReports.id }),
  );
  const reportId = inserted[0]?.id;
  if (!reportId) {
    return err('INTERNAL_ERROR', 'No se pudo crear el reporte.');
  }

  // Materialize template widgets if a template was requested.
  if (data.templateId) {
    const tpl = TEMPLATES[data.templateId as TemplateId];
    if (tpl) {
      await dbAs(
        { orgId: guard.session.orgId, userId: guard.session.userId },
        async (tx) => {
          await tx.insert(customReportWidgets).values(
            tpl.widgets.map((w) => ({
              customReportId: reportId,
              kind: w.kind,
              positionRow: w.positionRow,
              positionCol: w.positionCol,
              width: w.width,
              height: w.height,
              config: w.config as unknown as Record<string, unknown>,
            })),
          );
        },
      );
    }
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: guard.session.orgId,
        userId: guard.session.userId,
        actorType: 'user',
        action: 'custom_report.created',
        entityType: 'custom_report',
        entityId: reportId,
        after: {
          name: data.name,
          templateId: data.templateId ?? null,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit custom_report.created.',
      { cause, meta: { reportId } },
    );
  }

  revalidatePath('/reports/custom');
  return ok({ reportId });
}

// ---------------------------------------------------------------------------
// updateCustomReportAction (name/description/brand only — no audit)
// ---------------------------------------------------------------------------

export async function updateCustomReportAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ reportId: string }>> {
  const guard = await guardWrite();
  if (!guard.ok) return err(guard.error);

  const parsed = updateCustomReportSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos del reporte inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  const reportOrErr = await assertReportWritable(guard.session, data.reportId);
  if (reportOrErr instanceof AppError) return err(reportOrErr);

  const updates: Partial<CustomReport> = { updatedAt: new Date() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.brandId !== undefined) updates.brandId = data.brandId;

  await dbAs(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .update(customReports)
        .set(updates)
        .where(eq(customReports.id, data.reportId)),
  );
  revalidatePath(`/reports/custom/${data.reportId}`);
  revalidatePath(`/reports/custom/${data.reportId}/edit`);
  return ok({ reportId: data.reportId });
}

// ---------------------------------------------------------------------------
// addWidgetAction
// ---------------------------------------------------------------------------

export async function addWidgetAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ widgetId: string }>> {
  const guard = await guardWrite();
  if (!guard.ok) return err(guard.error);

  const parsed = addWidgetSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Widget inválido.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  const reportOrErr = await assertReportWritable(guard.session, data.reportId);
  if (reportOrErr instanceof AppError) return err(reportOrErr);

  // Per-kind config validation — render-only dispatcher.
  let validatedConfig: unknown;
  try {
    validatedConfig = validateWidgetConfig(data.kind, data.config);
  } catch (e) {
    return err('VALIDATION_ERROR', 'Configuración del widget inválida.', {
      meta: { issue: (e as Error).message },
    });
  }

  const inserted = await dbAs<Array<{ id: string }>>(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .insert(customReportWidgets)
        .values({
          customReportId: data.reportId,
          kind: data.kind,
          positionRow: data.positionRow,
          positionCol: data.positionCol,
          width: data.width ?? 1,
          height: data.height ?? 1,
          config: validatedConfig as Record<string, unknown>,
        })
        .returning({ id: customReportWidgets.id }),
  );

  revalidatePath(`/reports/custom/${data.reportId}/edit`);
  return ok({ widgetId: inserted[0]!.id });
}

// ---------------------------------------------------------------------------
// removeWidgetAction
// ---------------------------------------------------------------------------

export async function removeWidgetAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ widgetId: string }>> {
  const guard = await guardWrite();
  if (!guard.ok) return err(guard.error);

  const parsed = removeWidgetSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Widget id inválido.');
  }

  const widget = await dbAs<CustomReportWidget[]>(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .select()
        .from(customReportWidgets)
        .where(eq(customReportWidgets.id, parsed.data.widgetId))
        .limit(1),
  );
  if (widget.length === 0) {
    return err('NOT_FOUND', 'Widget no encontrado.');
  }

  await dbAs(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .delete(customReportWidgets)
        .where(eq(customReportWidgets.id, parsed.data.widgetId)),
  );

  revalidatePath(`/reports/custom/${widget[0]!.customReportId}/edit`);
  return ok({ widgetId: parsed.data.widgetId });
}

// ---------------------------------------------------------------------------
// updateWidgetConfigAction
// ---------------------------------------------------------------------------

export async function updateWidgetConfigAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ widgetId: string }>> {
  const guard = await guardWrite();
  if (!guard.ok) return err(guard.error);

  const parsed = updateWidgetConfigSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos inválidos.');
  }

  const existing = await dbAs<CustomReportWidget[]>(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .select()
        .from(customReportWidgets)
        .where(eq(customReportWidgets.id, parsed.data.widgetId))
        .limit(1),
  );
  if (existing.length === 0) {
    return err('NOT_FOUND', 'Widget no encontrado.');
  }
  const widget = existing[0]!;

  let validatedConfig: unknown;
  try {
    validatedConfig = validateWidgetConfig(widget.kind, parsed.data.config);
  } catch (e) {
    return err('VALIDATION_ERROR', 'Config inválido.', {
      meta: { issue: (e as Error).message },
    });
  }

  await dbAs(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .update(customReportWidgets)
        .set({
          config: validatedConfig as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(customReportWidgets.id, parsed.data.widgetId)),
  );

  revalidatePath(`/reports/custom/${widget.customReportId}/edit`);
  return ok({ widgetId: parsed.data.widgetId });
}

// ---------------------------------------------------------------------------
// moveWidgetAction (drag-drop persist)
// ---------------------------------------------------------------------------

export async function moveWidgetAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ widgetId: string }>> {
  const guard = await guardWrite();
  if (!guard.ok) return err(guard.error);

  const parsed = moveWidgetSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'Move inválido.');

  const existing = await dbAs<CustomReportWidget[]>(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .select()
        .from(customReportWidgets)
        .where(eq(customReportWidgets.id, parsed.data.widgetId))
        .limit(1),
  );
  if (existing.length === 0) {
    return err('NOT_FOUND', 'Widget no encontrado.');
  }
  const widget = existing[0]!;

  await dbAs(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .update(customReportWidgets)
        .set({
          positionRow: parsed.data.positionRow,
          positionCol: parsed.data.positionCol,
          width: parsed.data.width ?? widget.width,
          height: parsed.data.height ?? widget.height,
          updatedAt: new Date(),
        })
        .where(eq(customReportWidgets.id, parsed.data.widgetId)),
  );

  revalidatePath(`/reports/custom/${widget.customReportId}/edit`);
  return ok({ widgetId: parsed.data.widgetId });
}

// ---------------------------------------------------------------------------
// publishCustomReportAction (status transition + STRICT layout validation)
// ---------------------------------------------------------------------------

export async function publishCustomReportAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ reportId: string }>> {
  const guard = await guardWrite();
  if (!guard.ok) return err(guard.error);

  const parsed = publishCustomReportSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'Report id inválido.');

  const reportOrErr = await assertReportWritable(guard.session, parsed.data.reportId);
  if (reportOrErr instanceof AppError) return err(reportOrErr);

  // Strict layout validation — only on publish (D-39-7 a).
  const widgets = await dbAs<CustomReportWidget[]>(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .select()
        .from(customReportWidgets)
        .where(eq(customReportWidgets.customReportId, parsed.data.reportId)),
  );
  const validation = validateLayout(
    widgets.map((w) => ({
      id: w.id,
      positionRow: w.positionRow,
      positionCol: w.positionCol,
      width: w.width,
      height: w.height,
    })),
  );
  if (!validation.ok) {
    return err(
      'VALIDATION_ERROR',
      'Layout inválido — corregí solapamientos o widgets fuera del grid antes de publicar.',
      { meta: { errors: validation.errors } },
    );
  }

  const publishedAt = new Date();
  await dbAs(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .update(customReports)
        .set({
          status: 'published',
          publishedAt,
          updatedAt: publishedAt,
        })
        .where(eq(customReports.id, parsed.data.reportId)),
  );

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: guard.session.orgId,
        userId: guard.session.userId,
        actorType: 'user',
        action: 'custom_report.published',
        entityType: 'custom_report',
        entityId: parsed.data.reportId,
        after: { widgetCount: widgets.length },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit custom_report.published.',
      { cause, meta: { reportId: parsed.data.reportId } },
    );
  }

  revalidatePath(`/reports/custom/${parsed.data.reportId}`);
  revalidatePath(`/reports/custom`);
  return ok({ reportId: parsed.data.reportId });
}

// ---------------------------------------------------------------------------
// archiveCustomReportAction
// ---------------------------------------------------------------------------

export async function archiveCustomReportAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ reportId: string }>> {
  const guard = await guardWrite();
  if (!guard.ok) return err(guard.error);

  const parsed = archiveCustomReportSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'Report id inválido.');

  const archivedAt = new Date();
  await dbAs(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .update(customReports)
        .set({
          status: 'archived',
          archivedAt,
          updatedAt: archivedAt,
        })
        .where(
          and(
            eq(customReports.organizationId, guard.session.orgId),
            eq(customReports.id, parsed.data.reportId),
          ),
        ),
  );

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: guard.session.orgId,
        userId: guard.session.userId,
        actorType: 'user',
        action: 'custom_report.archived',
        entityType: 'custom_report',
        entityId: parsed.data.reportId,
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit custom_report.archived.',
      { cause, meta: { reportId: parsed.data.reportId } },
    );
  }

  revalidatePath('/reports/custom');
  return ok({ reportId: parsed.data.reportId });
}

// ---------------------------------------------------------------------------
// shareCustomReportAction
// ---------------------------------------------------------------------------

export async function shareCustomReportAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ reportId: string }>> {
  const guard = await guardWrite();
  if (!guard.ok) return err(guard.error);

  const parsed = shareCustomReportSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Share scope inválido.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  await dbAs(
    { orgId: guard.session.orgId, userId: guard.session.userId },
    (tx) =>
      tx
        .update(customReports)
        .set({
          shareScope: parsed.data.shareScope,
          sharedWith:
            parsed.data.shareScope === 'specific_users'
              ? parsed.data.sharedWith ?? []
              : [],
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(customReports.organizationId, guard.session.orgId),
            eq(customReports.id, parsed.data.reportId),
          ),
        ),
  );

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: guard.session.orgId,
        userId: guard.session.userId,
        actorType: 'user',
        action: 'custom_report.shared',
        entityType: 'custom_report',
        entityId: parsed.data.reportId,
        after: {
          shareScope: parsed.data.shareScope,
          sharedWith: parsed.data.sharedWith ?? [],
        },
        riskLevel: 'medium',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit custom_report.shared.',
      { cause, meta: { reportId: parsed.data.reportId } },
    );
  }

  revalidatePath(`/reports/custom/${parsed.data.reportId}`);
  return ok({ reportId: parsed.data.reportId });
}

// ---------------------------------------------------------------------------
// exportCustomReportHtmlAction (D-39-8 a — stub for Phase 11 PDF wiring)
// ---------------------------------------------------------------------------

export async function exportCustomReportHtmlAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ reportId: string; html: string }>> {
  const session = await requireUser();
  try {
    authorize(session.role, 'custom_reports:read');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }
  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'custom_reports');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = exportCustomReportHtmlSchema.safeParse(input);
  if (!parsed.success) return err('VALIDATION_ERROR', 'Report id inválido.');

  const now = new Date();
  const rangeStart = new Date(now.getTime() - 30 * 86_400_000);
  const result = await runCustomReport({
    orgId: session.orgId,
    userId: session.userId,
    reportId: parsed.data.reportId,
    rangeStart,
    rangeEnd: now,
  });

  // Minimal printable HTML. PDF conversion lands in Phase 11
  // (see TODO.md#custom-report-pdf-export-phase-11).
  const widgetsHtml = result.widgets
    .map((w) => {
      const title =
        w.payload && 'label' in w.payload && typeof w.payload.label === 'string'
          ? w.payload.label
          : w.kind;
      return `<section><h3>${escapeHtml(title)}</h3><pre>${escapeHtml(
        JSON.stringify(w.payload ?? { error: w.error }, null, 2),
      )}</pre></section>`;
    })
    .join('\n');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(result.name)}</title></head>
<body><h1>${escapeHtml(result.name)}</h1>${widgetsHtml}</body></html>`;

  return ok({ reportId: result.reportId, html });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
