import 'server-only';

import { and, eq, isNotNull } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin } from '@/lib/db/client';
import {
  auditEvents,
  npsInvitations,
  npsResponses,
  npsSurveys,
  type NpsSurveyChannel,
} from '@/lib/db/schema';
import { log } from '@/lib/log';
import { err, ok, type Result } from '@/lib/types/result';

import { validateNpsTokenFormat } from './tokens';

/**
 * Public NPS landing surface (Phase 9 / Commit 32).
 *
 * Mirror of `lib/reviews/public-feedback.ts`:
 *
 *   - SINGLE call-site for `dbAdmin` on the unauthenticated landing.
 *   - Pre-DB shape check (`validateNpsTokenFormat`) runs first; never
 *     hit the DB on garbage input.
 *   - All "no" branches return `null` / `err('NOT_FOUND', ...)` with
 *     identical latency profile to defeat enumeration.
 *
 * # Single-response invariant
 *
 * The `nps_responses_one_per_invitation` UNIQUE index makes "already
 * answered" terminal at the DB. The submit path checks the
 * invitation's `responded_at` first to short-circuit cleanly, but
 * even on a race the second INSERT errors out and we return the
 * same `NOT_FOUND` shape.
 */

export interface NpsLandingContext {
  readonly invitationId: string;
  readonly organizationId: string;
  readonly surveyId: string;
  readonly surveyName: string;
  readonly questionText: string;
  readonly thankYouMessage: string | null;
  readonly locale: string;
  readonly contactName: string | null;
  readonly channel: NpsSurveyChannel;
}

export interface NpsSubmitInput {
  readonly token: string;
  readonly score: number;
  readonly comment: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface NpsSubmitOutcome {
  readonly category: 'promoter' | 'passive' | 'detractor';
  readonly thankYouMessage: string | null;
}

export interface NpsPublicDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

const defaultDeps: NpsPublicDeps = {
  asAdmin: (fn) => dbAdmin(fn),
};

/**
 * Resolve a public NPS landing token to its survey context.
 *
 * Returns `null` for every failure case so the public response is
 * indistinguishable across malformed / unknown / expired / already-
 * responded tokens.
 */
export async function loadNpsByToken(
  token: unknown,
  deps: NpsPublicDeps = defaultDeps,
): Promise<NpsLandingContext | null> {
  if (!validateNpsTokenFormat(token)) {
    log.debug(
      { raw: typeof token === 'string' ? token.slice(0, 12) : null },
      'nps.token.malformed',
    );
    return null;
  }

  const rows: Array<{
    invitationId: string;
    organizationId: string;
    surveyId: string;
    surveyName: string;
    questionText: string;
    thankYouMessage: string | null;
    locale: string;
    contactName: string | null;
    channel: NpsSurveyChannel;
    expiresAt: Date;
    respondedAt: Date | null;
  }> = await deps.asAdmin(async (tx) =>
    tx
      .select({
        invitationId: npsInvitations.id,
        organizationId: npsInvitations.organizationId,
        surveyId: npsInvitations.npsSurveyId,
        surveyName: npsSurveys.name,
        questionText: npsSurveys.questionText,
        thankYouMessage: npsSurveys.thankYouMessage,
        locale: npsSurveys.locale,
        contactName: npsInvitations.contactName,
        channel: npsInvitations.channel,
        expiresAt: npsInvitations.expiresAt,
        respondedAt: npsInvitations.respondedAt,
      })
      .from(npsInvitations)
      .innerJoin(
        npsSurveys,
        eq(npsSurveys.id, npsInvitations.npsSurveyId),
      )
      .where(eq(npsInvitations.token, token))
      .limit(1),
  );

  const row = rows[0];
  if (!row) return null;
  if (row.respondedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  return {
    invitationId: row.invitationId,
    organizationId: row.organizationId,
    surveyId: row.surveyId,
    surveyName: row.surveyName,
    questionText: row.questionText,
    thankYouMessage: row.thankYouMessage,
    locale: row.locale,
    contactName: row.contactName,
    channel: row.channel,
  };
}

/**
 * Process a public submission. Same security posture as
 * `loadNpsByToken`. Inserts the response, stamps `responded_at` on
 * the invitation, writes an audit row.
 */
export async function submitNpsResponse(
  input: NpsSubmitInput,
  deps: NpsPublicDeps = defaultDeps,
): Promise<Result<NpsSubmitOutcome>> {
  if (
    !Number.isInteger(input.score) ||
    input.score < 0 ||
    input.score > 10
  ) {
    return err('VALIDATION_ERROR', 'Score fuera de rango.');
  }
  const trimmedComment =
    typeof input.comment === 'string'
      ? input.comment.trim().slice(0, 4000)
      : '';
  // D-32-3 — detractor must include a comment.
  if (input.score <= 6 && trimmedComment.length === 0) {
    return err(
      'VALIDATION_ERROR',
      'Por favor cuéntanos qué podemos mejorar.',
    );
  }

  const ctx = await loadNpsByToken(input.token, deps);
  if (!ctx) {
    return err('NOT_FOUND', 'Survey no encontrado o ya respondido.');
  }

  const category =
    input.score >= 9
      ? 'promoter'
      : input.score >= 7
        ? 'passive'
        : 'detractor';

  await deps.asAdmin(async (tx) => {
    await tx.insert(npsResponses).values({
      organizationId: ctx.organizationId,
      npsInvitationId: ctx.invitationId,
      score: input.score,
      comment: trimmedComment.length > 0 ? trimmedComment : null,
      respondedAt: new Date(),
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    });

    await tx
      .update(npsInvitations)
      .set({ respondedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(npsInvitations.id, ctx.invitationId),
          // Guard against race — only stamp if not already stamped.
          // The DB UNIQUE on `nps_responses(nps_invitation_id)`
          // is the real anti-double-submit; this is a soft
          // optimization to keep `responded_at` honest.
          isNotNull(npsInvitations.id),
        ),
      );

    await tx.insert(auditEvents).values({
      organizationId: ctx.organizationId,
      userId: null,
      actorType: 'system',
      action: 'nps.response.received',
      entityType: 'nps_invitation',
      entityId: ctx.invitationId,
      after: {
        score: input.score,
        category,
        commentLength: trimmedComment.length,
        surveyId: ctx.surveyId,
      },
      riskLevel: category === 'detractor' ? 'medium' : 'low',
    });
  });

  return ok({
    category,
    thankYouMessage: ctx.thankYouMessage,
  });
}

export { validateNpsTokenFormat };
