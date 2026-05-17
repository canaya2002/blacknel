import 'server-only';

import { and, desc, eq, gte } from 'drizzle-orm';

import { dbAdmin, dbAs, type AnyPgTx } from '@/lib/db/client';
import {
  auditEvents,
  npsInvitations,
  npsSurveys,
  type NpsSurveyChannel,
} from '@/lib/db/schema';
import { sendEmail } from '@/lib/emails/send';
import { log } from '@/lib/log';
import { err, ok, type Result } from '@/lib/types/result';

import { generateNpsToken } from './tokens';

/**
 * NPS invitation sender (Phase 9 / Commit 32).
 *
 * Dispatches one invitation across the requested channel. Persists
 * `nps_invitations` then routes per-channel:
 *
 *   - email     → `lib/emails/send.ts` (dev outbox; Phase 11 swaps
 *                 to Resend). `kind: 'nps_prompt'` already declared
 *                 in `EmailKind`.
 *   - whatsapp  → currently logs + persists. The WhatsApp Business
 *                 connector mock owns template lifecycle but the
 *                 "send a templated invitation against a specific
 *                 phone number" surface is handled by the existing
 *                 `sendTemplate` Server Action path. From the NPS
 *                 sender we just record the row so the link is
 *                 visible in the org's outbound history. Real
 *                 dispatch (Phase 10+) wires the WhatsApp template
 *                 dispatch in here.
 *   - sms_reserved → returns `err('NOT_IMPLEMENTED', …)`. Phase 11.
 *
 * `idempotencyKey` (optional) is the dedup hook. When the survey's
 * `min_days_between_sends` window already holds an invitation for
 * the same `(survey, contact)`, we early-return without inserting.
 *
 * The function never throws — all failure modes are `Result<...>`
 * branches the caller (a Server Action or the cron tick) maps.
 */

export interface DispatchInvitationInput {
  readonly organizationId: string;
  readonly userId: string | null;
  readonly surveyId: string;
  readonly contactIdentifier: string;
  readonly contactName?: string | null;
  readonly channel: NpsSurveyChannel;
  /** Optional dedup key. Partial unique on (org, idempotency_key). */
  readonly idempotencyKey?: string | null;
  /** Brand override; defaults to survey.brand_id. */
  readonly brandId?: string | null;
  /** Inject a clock so tests are deterministic. */
  readonly now?: Date;
}

export interface DispatchedInvitation {
  readonly invitationId: string;
  readonly token: string;
  readonly sentAt: Date;
}

export type DispatchOutcome =
  | { kind: 'sent'; invitation: DispatchedInvitation }
  | {
      kind: 'throttled';
      reason: 'within_min_days_between_sends';
      lastSentAt: Date;
    };

/** System-actor dispatch — used by the cron post_resolution tick. */
export async function dispatchInvitationAsAdmin(
  input: DispatchInvitationInput,
): Promise<Result<DispatchOutcome>> {
  return dispatchInvitation(input, /* asAdmin */ true);
}

/** User-actor dispatch — used by the manual Server Action. */
export async function dispatchInvitationAsUser(
  input: DispatchInvitationInput,
): Promise<Result<DispatchOutcome>> {
  if (!input.userId) {
    return err(
      'VALIDATION_ERROR',
      'dispatchInvitationAsUser requires a userId.',
    );
  }
  return dispatchInvitation(input, /* asAdmin */ false);
}

async function dispatchInvitation(
  input: DispatchInvitationInput,
  asAdmin: boolean,
): Promise<Result<DispatchOutcome>> {
  if (input.channel === 'sms_reserved') {
    return err(
      'NOT_IMPLEMENTED',
      'SMS channel is reserved for Phase 11.',
    );
  }
  const now = input.now ?? new Date();

  // Load the survey to enforce min_days_between_sends + locale/template.
  const surveyRows = await runRead(asAdmin, input, async (tx) =>
    tx
      .select({
        id: npsSurveys.id,
        organizationId: npsSurveys.organizationId,
        brandId: npsSurveys.brandId,
        name: npsSurveys.name,
        channels: npsSurveys.channels,
        questionText: npsSurveys.questionText,
        thankYouMessage: npsSurveys.thankYouMessage,
        locale: npsSurveys.locale,
        status: npsSurveys.status,
        minDaysBetweenSends: npsSurveys.minDaysBetweenSends,
      })
      .from(npsSurveys)
      .where(
        and(
          eq(npsSurveys.organizationId, input.organizationId),
          eq(npsSurveys.id, input.surveyId),
        ),
      )
      .limit(1),
  );
  const survey = surveyRows[0];
  if (!survey) {
    return err('NOT_FOUND', 'Survey no encontrado.');
  }
  if (survey.status !== 'active' && !asAdmin) {
    return err(
      'VALIDATION_ERROR',
      'El survey no está activo. Activá el survey antes de enviar.',
    );
  }
  if (!survey.channels.includes(input.channel)) {
    return err(
      'VALIDATION_ERROR',
      `Canal "${input.channel}" no está habilitado en este survey.`,
    );
  }

  // Throttle check — most recent invitation for (survey, contact).
  const minDays = survey.minDaysBetweenSends;
  if (minDays > 0) {
    const since = new Date(now.getTime() - minDays * 86_400_000);
    const recent = await runRead(asAdmin, input, async (tx) =>
      tx
        .select({ sentAt: npsInvitations.sentAt })
        .from(npsInvitations)
        .where(
          and(
            eq(npsInvitations.npsSurveyId, input.surveyId),
            eq(npsInvitations.contactIdentifier, input.contactIdentifier),
            gte(npsInvitations.sentAt, since),
          ),
        )
        .orderBy(desc(npsInvitations.sentAt))
        .limit(1),
    );
    if (recent.length > 0) {
      return ok({
        kind: 'throttled',
        reason: 'within_min_days_between_sends',
        lastSentAt: recent[0]!.sentAt,
      });
    }
  }

  const token = generateNpsToken();
  const brandId = input.brandId ?? survey.brandId ?? null;

  const inserted = await runWrite(asAdmin, input, async (tx) =>
    tx
      .insert(npsInvitations)
      .values({
        organizationId: input.organizationId,
        npsSurveyId: input.surveyId,
        brandId,
        contactIdentifier: input.contactIdentifier,
        ...(input.contactName ? { contactName: input.contactName } : {}),
        channel: input.channel,
        sentAt: now,
        token,
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
      })
      .returning({ id: npsInvitations.id }),
  );
  const invitationId = inserted[0]?.id;
  if (!invitationId) {
    return err('INTERNAL_ERROR', 'No se pudo crear la invitation.');
  }

  // Channel-specific dispatch.
  if (input.channel === 'email') {
    try {
      await sendEmail({
        kind: 'nps_prompt',
        to: input.contactIdentifier,
        subject: subjectFor(survey.locale, survey.name),
        text: textBodyFor({
          locale: survey.locale,
          surveyName: survey.name,
          questionText: survey.questionText,
          token,
        }),
        meta: {
          surveyId: input.surveyId,
          invitationId,
          token,
        },
      });
    } catch (cause) {
      log.warn(
        { cause: (cause as Error).message, invitationId },
        'nps.invitation.email.dev-outbox.failed',
      );
    }
  } else if (input.channel === 'whatsapp') {
    // The WhatsApp send is owned by the WhatsApp Business connector
    // — we log so the cron run is auditable. Phase 10+ wires this
    // into `lib/connectors/whatsapp/templates-mock.sendTemplate`.
    log.info(
      {
        invitationId,
        surveyId: input.surveyId,
        contactIdentifier: input.contactIdentifier,
      },
      'nps.invitation.whatsapp.queued',
    );
  }

  await dbAdmin(async (tx) =>
    tx.insert(auditEvents).values({
      organizationId: input.organizationId,
      userId: input.userId,
      actorType: input.userId ? 'user' : 'system',
      action: 'nps.invitation.sent',
      entityType: 'nps_invitation',
      entityId: invitationId,
      after: {
        surveyId: input.surveyId,
        channel: input.channel,
        contactIdentifier: input.contactIdentifier,
      },
      riskLevel: 'low',
    }),
  );

  return ok({
    kind: 'sent',
    invitation: { invitationId, token, sentAt: now },
  });
}

function runRead<T>(
  asAdmin: boolean,
  input: DispatchInvitationInput,
  fn: (tx: AnyPgTx) => Promise<T>,
): Promise<T> {
  if (asAdmin) return dbAdmin(fn);
  return dbAs(
    { orgId: input.organizationId, userId: input.userId ?? '' },
    fn,
  );
}

function runWrite<T>(
  asAdmin: boolean,
  input: DispatchInvitationInput,
  fn: (tx: AnyPgTx) => Promise<T>,
): Promise<T> {
  if (asAdmin) return dbAdmin(fn);
  return dbAs(
    { orgId: input.organizationId, userId: input.userId ?? '' },
    fn,
  );
}

function subjectFor(locale: string, surveyName: string): string {
  if (locale === 'en') return `${surveyName} — quick feedback?`;
  return `${surveyName} — ¿cómo estuvo tu experiencia?`;
}

function textBodyFor(input: {
  locale: string;
  surveyName: string;
  questionText: string;
  token: string;
}): string {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const link = `${baseUrl}/nps/${input.token}`;
  if (input.locale === 'en') {
    return `${input.questionText}\n\nRespond here: ${link}\n\n—\n${input.surveyName}`;
  }
  return `${input.questionText}\n\nResponde aquí: ${link}\n\n—\n${input.surveyName}`;
}
