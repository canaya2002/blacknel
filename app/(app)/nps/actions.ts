'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import {
  auditEvents,
  npsSurveys,
  type NpsSurvey,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { dispatchInvitationAsUser } from '@/lib/nps/sender';
import {
  createNpsSurveySchema,
  exportNpsCsvSchema,
  sendNpsInvitationSchema,
  updateNpsSurveySchema,
} from '@/lib/nps/validate';
import {
  computeNps,
  listResponses,
  type NpsResponseRow,
} from '@/lib/nps/queries';
import { authorize } from '@/lib/permissions/can';
import { requirePlanFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * NPS Server Actions (Phase 9 / Commit 32).
 *
 *   - `createNpsSurveyAction`        — admin/manager+ creates a survey.
 *   - `updateNpsSurveyAction`        — admin/manager+ edits a survey.
 *   - `archiveNpsSurveyAction`       — soft delete via `status='archived'`.
 *   - `sendNpsInvitationAction`      — manual dispatch (batched ≤100).
 *   - `listNpsResponsesAction`       — paginated feed for the Respuestas tab.
 *   - `exportNpsResponsesCsvAction`  — CSV download (Ajuste A).
 *
 * Every action runs `requirePlanFeature(plan, 'nps_surveys')`,
 * `authorize(session.role, ...)`, and emits an audit event. Same
 * defense-in-depth posture as WhatsApp Server Actions (Commit 31).
 */

// ---------------------------------------------------------------------------
// createNpsSurveyAction
// ---------------------------------------------------------------------------

export async function createNpsSurveyAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ surveyId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'nps:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'nps_surveys');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = createNpsSurveySchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos del survey inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  const inserted = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .insert(npsSurveys)
        .values({
          organizationId: session.orgId,
          ...(data.brandId ? { brandId: data.brandId } : {}),
          name: data.name,
          trigger: data.trigger,
          channels: data.channels,
          questionText: data.questionText,
          ...(data.thankYouMessage
            ? { thankYouMessage: data.thankYouMessage }
            : {}),
          locale: data.locale,
          status: data.status,
          minDaysBetweenSends: data.minDaysBetweenSends,
        })
        .returning({ id: npsSurveys.id }),
  );
  const surveyId = inserted[0]?.id;
  if (!surveyId) {
    return err('INTERNAL_ERROR', 'No se pudo crear el survey.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'nps.survey.created',
        entityType: 'nps_survey',
        entityId: surveyId,
        after: {
          name: data.name,
          trigger: data.trigger,
          channels: data.channels,
          status: data.status,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit nps.survey.created.',
      { cause, meta: { surveyId } },
    );
  }

  revalidatePath('/nps');
  return ok({ surveyId });
}

// ---------------------------------------------------------------------------
// updateNpsSurveyAction
// ---------------------------------------------------------------------------

export async function updateNpsSurveyAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ surveyId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'nps:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'nps_surveys');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = updateNpsSurveySchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos del survey inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  // Load the row first so the audit row carries before+after.
  const existing = await dbAs<NpsSurvey[]>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select()
        .from(npsSurveys)
        .where(
          and(
            eq(npsSurveys.organizationId, session.orgId),
            eq(npsSurveys.id, data.id),
          ),
        )
        .limit(1),
  );
  const prior = existing[0];
  if (!prior) {
    return err('NOT_FOUND', 'Survey no encontrado.');
  }

  await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(npsSurveys)
      .set({
        brandId: data.brandId ?? null,
        name: data.name,
        trigger: data.trigger,
        channels: data.channels,
        questionText: data.questionText,
        thankYouMessage: data.thankYouMessage ?? null,
        locale: data.locale,
        status: data.status,
        minDaysBetweenSends: data.minDaysBetweenSends,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(npsSurveys.organizationId, session.orgId),
          eq(npsSurveys.id, data.id),
        ),
      ),
  );

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'nps.survey.updated',
        entityType: 'nps_survey',
        entityId: data.id,
        before: {
          name: prior.name,
          status: prior.status,
          channels: prior.channels,
        },
        after: {
          name: data.name,
          status: data.status,
          channels: data.channels,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit nps.survey.updated.',
      { cause, meta: { surveyId: data.id } },
    );
  }

  revalidatePath('/nps');
  revalidatePath(`/nps/surveys/${data.id}`);
  return ok({ surveyId: data.id });
}

// ---------------------------------------------------------------------------
// archiveNpsSurveyAction
// ---------------------------------------------------------------------------

export async function archiveNpsSurveyAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ surveyId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'nps:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'nps_surveys');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const surveyId =
    input && typeof input === 'object' && 'surveyId' in input
      ? String((input as { surveyId: unknown }).surveyId)
      : '';
  if (!/^[0-9a-f-]{36}$/i.test(surveyId)) {
    return err('VALIDATION_ERROR', 'surveyId inválido.');
  }

  const now = new Date();
  const updated = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .update(npsSurveys)
        .set({ status: 'archived', archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(npsSurveys.organizationId, session.orgId),
            eq(npsSurveys.id, surveyId),
          ),
        )
        .returning({ id: npsSurveys.id }),
  );
  if (updated.length === 0) {
    return err('NOT_FOUND', 'Survey no encontrado.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'nps.survey.archived',
        entityType: 'nps_survey',
        entityId: surveyId,
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit nps.survey.archived.',
      { cause, meta: { surveyId } },
    );
  }

  revalidatePath('/nps');
  return ok({ surveyId });
}

// ---------------------------------------------------------------------------
// sendNpsInvitationAction — manual trigger
// ---------------------------------------------------------------------------

export async function sendNpsInvitationAction(
  _prev: unknown,
  input: unknown,
): Promise<
  Result<{
    sent: number;
    throttled: number;
    skipped: number;
  }>
> {
  const session = await requireUser();
  authorize(session.role, 'nps:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'nps_surveys');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = sendNpsInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos de envío inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const { surveyId, contacts } = parsed.data;

  let sent = 0;
  let throttled = 0;
  let skipped = 0;

  for (const contact of contacts) {
    const r = await dispatchInvitationAsUser({
      organizationId: session.orgId,
      userId: session.userId,
      surveyId,
      contactIdentifier: contact.contactIdentifier,
      ...(contact.contactName ? { contactName: contact.contactName } : {}),
      channel: contact.channel,
      ...(contact.idempotencyKey
        ? { idempotencyKey: contact.idempotencyKey }
        : {}),
    });
    if (!r.ok) {
      skipped += 1;
      continue;
    }
    if (r.data.kind === 'throttled') throttled += 1;
    else sent += 1;
  }

  revalidatePath('/nps');
  return ok({ sent, throttled, skipped });
}

// ---------------------------------------------------------------------------
// listNpsResponsesAction
// ---------------------------------------------------------------------------

export async function listNpsResponsesAction(
  _prev: unknown,
  input: unknown,
): Promise<
  Result<{
    responses: NpsResponseRow[];
    aggregates: ReturnType<typeof computeNps>;
  }>
> {
  const session = await requireUser();
  authorize(session.role, 'nps:read');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'nps_surveys');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const surveyId =
    input && typeof input === 'object' && 'surveyId' in input
      ? ((input as { surveyId: string | null }).surveyId ?? null)
      : null;
  const limit =
    input && typeof input === 'object' && 'limit' in input
      ? Number((input as { limit: number }).limit)
      : 100;

  const responses = await listResponses({
    orgId: session.orgId,
    userId: session.userId,
    surveyId,
    limit,
  });
  // For the inline aggregates next to the feed, count the listed
  // responses against the listed invitations they came from (i.e.
  // the "response rate" denominator is invitation_count of these
  // results, not the org's lifetime invitations). The /nps/Analytics
  // tab uses `getOrgAggregates` directly for the broader number.
  const aggregates = computeNps(responses, responses.length);

  return ok({ responses, aggregates });
}

// ---------------------------------------------------------------------------
// exportNpsResponsesCsvAction — Ajuste A
// ---------------------------------------------------------------------------

export interface NpsExportCsvSuccess {
  readonly csv: string;
  readonly filename: string;
  readonly rowCount: number;
  readonly sizeBytes: number;
}

export async function exportNpsResponsesCsvAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<NpsExportCsvSuccess>> {
  const session = await requireUser();
  authorize(session.role, 'nps:read');
  authorize(session.role, 'reports:export');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'nps_surveys');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = exportNpsCsvSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Parámetros de export inválidos.');
  }
  const { period } = parsed.data;
  const surveyId = parsed.data.surveyId ?? null;

  const sinceDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const now = new Date();

  const responses = await listResponses({
    orgId: session.orgId,
    userId: session.userId,
    surveyId,
    limit: 1000,
    sinceDays,
  });

  const header: string[] = [
    'invitation_token',
    'contact_identifier',
    'contact_name',
    'channel',
    'sent_at',
    'responded_at',
    'score',
    'category',
    'comment',
  ];
  const dataRows: string[][] = responses.map((r) => [
    r.invitationToken,
    r.contactIdentifier,
    r.contactName ?? '',
    r.channel,
    r.sentAt.toISOString(),
    r.respondedAt.toISOString(),
    String(r.score),
    r.category,
    r.comment ?? '',
  ]);
  const rows: ReadonlyArray<string[]> = [header, ...dataRows];

  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const sizeBytes = Buffer.byteLength(csv, 'utf8');
  const filename = `blacknel-nps-${period}-${now.toISOString().slice(0, 10)}.csv`;
  const rowCount = dataRows.length;

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'reports.csv.exported',
        entityType: 'report',
        entityId: null,
        after: {
          section: 'nps',
          surveyId,
          period,
          rowCount,
          sizeBytes,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit reports.csv.exported (nps).',
      { cause, meta: { period, surveyId } },
    );
  }

  return ok({ csv, filename, rowCount, sizeBytes });
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
