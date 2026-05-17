import 'server-only';

import { sql } from 'drizzle-orm';

import {
  npsInvitations,
  npsResponses,
  npsSurveys,
  type NpsSurveyChannel,
} from './schema';
import { SEED_IDS } from './seed';

import type { AnyPgTx } from './client';

/**
 * NPS demo seed (Phase 9 / Commit 32, Ajuste J).
 *
 * Gated by `env.BLACKNEL_SEED_NPS`. Integration tests turn it off
 * via `tests/helpers/react-act-setup.ts` to keep their seeded
 * worlds minimal.
 *
 * What lands:
 *
 *   - 2 NPS surveys (one active post_resolution + one draft periodic).
 *   - 50 invitations across both surveys with realistic time
 *     distribution (last 90 days).
 *   - Responses for ~70% of invitations (35 responses) with the
 *     spec-mandated mix: 50% promoters / 25% passives / 25%
 *     detractors. Detractors carry a non-empty comment to satisfy
 *     the `nps_responses_detractor_comment` CHECK constraint.
 *
 * Idempotency via deterministic UUIDs + `ON CONFLICT DO NOTHING`.
 * Re-running the seed is a no-op.
 */

const ORG = SEED_IDS.org.demo;

const SURVEY_IDS = {
  postResolution: '99999999-9999-4999-8999-000000000001',
  periodic: '99999999-9999-4999-8999-000000000002',
} as const;

interface InvitationSeed {
  id: string;
  surveyId: string;
  contactIdentifier: string;
  contactName: string;
  channel: NpsSurveyChannel;
  daysAgo: number;
  /** 0-10 if responded, null otherwise. */
  responseScore: number | null;
  /** Per-row deterministic comment if score ≤ 6. */
  comment: string | null;
}

/**
 * 50 deterministic invitations across two surveys. The score mix
 * targets the 50/25/25 spec:
 *
 *   - 17 promoters (score 9 or 10)
 *   - 9 passives (score 7 or 8)
 *   - 9 detractors (score 0-6, all carry comments)
 *   - 15 unresponded (responseScore = null)
 *
 * Total responses = 35.
 */
const INVITATION_SEEDS: ReadonlyArray<InvitationSeed> = (() => {
  const out: InvitationSeed[] = [];
  const promoterScores = [9, 10, 10, 9, 10, 9, 10, 10, 9, 9, 10, 9, 10, 9, 10, 9, 10];
  const passiveScores = [7, 8, 7, 8, 7, 8, 7, 8, 7];
  const detractorScores = [6, 5, 4, 3, 2, 6, 5, 4, 3];
  const detractorComments = [
    'Tardaron mucho en atenderme.',
    'No me dieron seguimiento al pedido.',
    'El producto llegó dañado.',
    'Esperaba mejor servicio para el precio.',
    'La cita se canceló sin previo aviso.',
    'El horario no es práctico para mí.',
    'Me costó mucho conseguir respuesta por chat.',
    'Quedó pendiente lo que pedí.',
    'No reciben tarjeta y no avisan antes.',
  ];

  const surveys: ReadonlyArray<{ id: string; channel: NpsSurveyChannel }> = [
    { id: SURVEY_IDS.postResolution, channel: 'email' },
    { id: SURVEY_IDS.periodic, channel: 'email' },
  ];

  let idx = 0;
  const bucket = (n: number): { score: number | null; comment: string | null } => {
    if (n < 17) {
      const score = promoterScores[n] ?? 9;
      return { score, comment: null };
    }
    if (n < 17 + 9) {
      const score = passiveScores[n - 17] ?? 7;
      return { score, comment: null };
    }
    if (n < 17 + 9 + 9) {
      const i = n - 17 - 9;
      const score = detractorScores[i] ?? 5;
      const comment = detractorComments[i] ?? 'Sin más detalle por ahora.';
      return { score, comment };
    }
    return { score: null, comment: null };
  };

  for (let i = 0; i < 50; i += 1) {
    const survey = surveys[i % 2]!;
    const b = bucket(i);
    out.push({
      id: `99999999-9999-4999-8999-${String(i + 1).padStart(12, '0')}`,
      surveyId: survey.id,
      contactIdentifier: `customer${i + 1}@blacknel.demo`,
      contactName: `Cliente ${i + 1}`,
      channel: survey.channel,
      daysAgo: ((i * 7) % 85) + 1,
      responseScore: b.score,
      comment: b.comment,
    });
    idx += 1;
  }
  void idx;
  return out;
})();

export async function seedNps(tx: AnyPgTx): Promise<void> {
  const now = new Date();

  // 1. Surveys.
  await tx
    .insert(npsSurveys)
    .values([
      {
        id: SURVEY_IDS.postResolution,
        organizationId: ORG,
        name: 'Post-resolución · Inbox',
        trigger: 'post_resolution',
        channels: ['email'],
        questionText:
          '¿Qué tan probable es que recomiendes nuestra atención a un amigo o colega?',
        thankYouMessage:
          '¡Gracias por tu feedback! Si querés contarnos más, respondé a este mismo correo.',
        locale: 'es',
        status: 'active',
        minDaysBetweenSends: 90,
      },
      {
        id: SURVEY_IDS.periodic,
        organizationId: ORG,
        name: 'NPS trimestral · Clientes activos',
        trigger: 'periodic',
        channels: ['email'],
        questionText:
          '¿Qué tan probable es que recomiendes nuestra marca a un amigo o colega?',
        thankYouMessage: '¡Gracias!',
        locale: 'es',
        status: 'draft',
        minDaysBetweenSends: 90,
      },
    ])
    .onConflictDoNothing({ target: npsSurveys.id });

  // 2. Invitations.
  await tx
    .insert(npsInvitations)
    .values(
      INVITATION_SEEDS.map((inv) => {
        const sentAt = addDays(now, -inv.daysAgo);
        return {
          id: inv.id,
          organizationId: ORG,
          npsSurveyId: inv.surveyId,
          contactIdentifier: inv.contactIdentifier,
          contactName: inv.contactName,
          channel: inv.channel,
          sentAt,
          token: `bnf_nps_${inv.id.replace(/-/g, '').slice(0, 32)}`,
          ...(inv.responseScore !== null
            ? { respondedAt: addDays(sentAt, 1) }
            : {}),
        };
      }),
    )
    .onConflictDoNothing({ target: npsInvitations.id });

  // 3. Responses (only where responseScore !== null).
  const responseRows = INVITATION_SEEDS.filter(
    (inv) => inv.responseScore !== null,
  ).map((inv) => {
    const sentAt = addDays(now, -inv.daysAgo);
    const respondedAt = addDays(sentAt, 1);
    return {
      id: inv.id.replace(/^9/, '8'), // distinct id space for responses
      organizationId: ORG,
      npsInvitationId: inv.id,
      score: inv.responseScore as number,
      ...(inv.comment ? { comment: inv.comment } : {}),
      respondedAt,
    };
  });
  if (responseRows.length > 0) {
    await tx
      .insert(npsResponses)
      .values(responseRows)
      .onConflictDoNothing({ target: npsResponses.id });
  }
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

// Keep `sql` import live for future expansion.
void sql;
