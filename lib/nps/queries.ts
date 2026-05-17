import 'server-only';

import { and, desc, eq, gte, sql } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import {
  npsInvitations,
  npsResponses,
  npsSurveys,
  type NpsResponseCategory,
  type NpsSurvey,
  type NpsSurveyChannel,
} from '@/lib/db/schema';

/**
 * Read layer for NPS (Phase 9 / Commit 32).
 *
 * All RLS-bound — every entry point goes through `dbAs`.
 */

export interface NpsSurveyRow {
  readonly id: string;
  readonly brandId: string | null;
  readonly name: string;
  readonly trigger: NpsSurvey['trigger'];
  readonly channels: ReadonlyArray<NpsSurveyChannel>;
  readonly questionText: string;
  readonly thankYouMessage: string | null;
  readonly locale: string;
  readonly status: NpsSurvey['status'];
  readonly minDaysBetweenSends: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
  readonly responseCount: number;
}

export async function listSurveysWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<NpsSurveyRow[]> {
  const rows: Array<{
    survey: NpsSurvey;
    responseCount: number;
  }> = await tx
    .select({
      survey: npsSurveys,
      responseCount: sql<number>`COALESCE((
        SELECT COUNT(*)::int FROM ${npsResponses}
        INNER JOIN ${npsInvitations}
          ON ${npsInvitations}.id = ${npsResponses}.nps_invitation_id
        WHERE ${npsInvitations}.nps_survey_id = ${npsSurveys}.id
      ), 0)`,
    })
    .from(npsSurveys)
    .where(eq(npsSurveys.organizationId, orgId))
    .orderBy(desc(npsSurveys.createdAt));

  return rows.map((r) => mapSurveyRow(r.survey, r.responseCount));
}

export async function listSurveys(ctx: {
  orgId: string;
  userId: string;
}): Promise<NpsSurveyRow[]> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    listSurveysWithTx(tx, ctx.orgId),
  );
}

export async function getSurveyByIdWithTx(
  tx: AnyPgTx,
  orgId: string,
  surveyId: string,
): Promise<NpsSurveyRow | null> {
  const rows: Array<{ survey: NpsSurvey; responseCount: number }> = await tx
    .select({
      survey: npsSurveys,
      responseCount: sql<number>`COALESCE((
        SELECT COUNT(*)::int FROM ${npsResponses}
        INNER JOIN ${npsInvitations}
          ON ${npsInvitations}.id = ${npsResponses}.nps_invitation_id
        WHERE ${npsInvitations}.nps_survey_id = ${npsSurveys}.id
      ), 0)`,
    })
    .from(npsSurveys)
    .where(
      and(
        eq(npsSurveys.organizationId, orgId),
        eq(npsSurveys.id, surveyId),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return mapSurveyRow(r.survey, r.responseCount);
}

export async function getSurveyById(ctx: {
  orgId: string;
  userId: string;
  surveyId: string;
}): Promise<NpsSurveyRow | null> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    getSurveyByIdWithTx(tx, ctx.orgId, ctx.surveyId),
  );
}

function mapSurveyRow(s: NpsSurvey, responseCount: number): NpsSurveyRow {
  return {
    id: s.id,
    brandId: s.brandId,
    name: s.name,
    trigger: s.trigger,
    channels: (Array.isArray(s.channels) ? s.channels : []) as ReadonlyArray<NpsSurveyChannel>,
    questionText: s.questionText,
    thankYouMessage: s.thankYouMessage,
    locale: s.locale,
    status: s.status,
    minDaysBetweenSends: s.minDaysBetweenSends,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    archivedAt: s.archivedAt,
    responseCount,
  };
}

// ---------------------------------------------------------------------------
// Responses feed
// ---------------------------------------------------------------------------

export interface NpsResponseRow {
  readonly id: string;
  readonly score: number;
  readonly category: NpsResponseCategory;
  readonly comment: string | null;
  readonly respondedAt: Date;
  readonly contactIdentifier: string;
  readonly contactName: string | null;
  readonly channel: NpsSurveyChannel;
  readonly invitationId: string;
  readonly surveyId: string;
  readonly surveyName: string;
  readonly invitationToken: string;
  readonly sentAt: Date;
}

export interface ListResponsesOptions {
  readonly surveyId?: string | null;
  readonly limit?: number;
  readonly sinceDays?: number;
}

export async function listResponsesWithTx(
  tx: AnyPgTx,
  orgId: string,
  opts: ListResponsesOptions = {},
): Promise<NpsResponseRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const conds = [eq(npsResponses.organizationId, orgId)];
  if (opts.surveyId) {
    conds.push(eq(npsInvitations.npsSurveyId, opts.surveyId));
  }
  if (opts.sinceDays && opts.sinceDays > 0) {
    const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
    conds.push(gte(npsResponses.respondedAt, since));
  }
  const rows: Array<{
    id: string;
    score: number;
    category: NpsResponseCategory;
    comment: string | null;
    respondedAt: Date;
    contactIdentifier: string;
    contactName: string | null;
    channel: NpsSurveyChannel;
    invitationId: string;
    surveyId: string;
    surveyName: string;
    invitationToken: string;
    sentAt: Date;
  }> = await tx
    .select({
      id: npsResponses.id,
      score: npsResponses.score,
      category: npsResponses.category,
      comment: npsResponses.comment,
      respondedAt: npsResponses.respondedAt,
      contactIdentifier: npsInvitations.contactIdentifier,
      contactName: npsInvitations.contactName,
      channel: npsInvitations.channel,
      invitationId: npsInvitations.id,
      surveyId: npsInvitations.npsSurveyId,
      surveyName: npsSurveys.name,
      invitationToken: npsInvitations.token,
      sentAt: npsInvitations.sentAt,
    })
    .from(npsResponses)
    .innerJoin(
      npsInvitations,
      eq(npsInvitations.id, npsResponses.npsInvitationId),
    )
    .innerJoin(npsSurveys, eq(npsSurveys.id, npsInvitations.npsSurveyId))
    .where(and(...conds))
    .orderBy(desc(npsResponses.respondedAt))
    .limit(limit);

  return rows;
}

export async function listResponses(ctx: {
  orgId: string;
  userId: string;
  surveyId?: string | null;
  limit?: number;
  sinceDays?: number;
}): Promise<NpsResponseRow[]> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    listResponsesWithTx(tx, ctx.orgId, {
      surveyId: ctx.surveyId ?? null,
      limit: ctx.limit ?? 100,
      sinceDays: ctx.sinceDays ?? 0,
    }),
  );
}

// ---------------------------------------------------------------------------
// Aggregates — NPS score, breakdown, response rate
// ---------------------------------------------------------------------------

export interface NpsAggregates {
  readonly responseCount: number;
  readonly invitationCount: number;
  readonly responseRate: number;
  readonly promoters: number;
  readonly passives: number;
  readonly detractors: number;
  readonly nps: number;
  readonly promoterPct: number;
  readonly passivePct: number;
  readonly detractorPct: number;
}

/**
 * Pure aggregation over an array of (score, category) tuples. Exposed
 * separately from the DB-fetching code so the unit test can drive it
 * with synthetic data and verify the math directly.
 */
export function computeNps(
  responses: ReadonlyArray<{ category: NpsResponseCategory }>,
  invitationCount: number,
): NpsAggregates {
  const total = responses.length;
  const promoters = responses.filter((r) => r.category === 'promoter').length;
  const passives = responses.filter((r) => r.category === 'passive').length;
  const detractors = responses.filter(
    (r) => r.category === 'detractor',
  ).length;

  const promoterPct = total === 0 ? 0 : (promoters / total) * 100;
  const passivePct = total === 0 ? 0 : (passives / total) * 100;
  const detractorPct = total === 0 ? 0 : (detractors / total) * 100;
  const nps = total === 0 ? 0 : Math.round(promoterPct - detractorPct);
  const responseRate =
    invitationCount === 0
      ? 0
      : Math.round((total / invitationCount) * 1000) / 10;

  return {
    responseCount: total,
    invitationCount,
    responseRate,
    promoters,
    passives,
    detractors,
    nps,
    promoterPct: Math.round(promoterPct * 10) / 10,
    passivePct: Math.round(passivePct * 10) / 10,
    detractorPct: Math.round(detractorPct * 10) / 10,
  };
}

export async function getOrgAggregatesWithTx(
  tx: AnyPgTx,
  orgId: string,
  opts: { surveyId?: string | null; sinceDays?: number } = {},
): Promise<NpsAggregates> {
  const conds = [eq(npsResponses.organizationId, orgId)];
  const invConds = [eq(npsInvitations.organizationId, orgId)];
  if (opts.surveyId) {
    conds.push(eq(npsInvitations.npsSurveyId, opts.surveyId));
    invConds.push(eq(npsInvitations.npsSurveyId, opts.surveyId));
  }
  if (opts.sinceDays && opts.sinceDays > 0) {
    const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
    conds.push(gte(npsResponses.respondedAt, since));
    invConds.push(gte(npsInvitations.sentAt, since));
  }
  const responseRows: Array<{ category: NpsResponseCategory }> = await tx
    .select({ category: npsResponses.category })
    .from(npsResponses)
    .innerJoin(
      npsInvitations,
      eq(npsInvitations.id, npsResponses.npsInvitationId),
    )
    .where(and(...conds));

  const invitationRows: Array<{ count: number }> = await tx
    .select({
      count: sql<number>`COUNT(*)::int`,
    })
    .from(npsInvitations)
    .where(and(...invConds));
  const invitationCount = invitationRows[0]?.count ?? 0;

  return computeNps(responseRows, invitationCount);
}

export async function getOrgAggregates(ctx: {
  orgId: string;
  userId: string;
  surveyId?: string | null;
  sinceDays?: number;
}): Promise<NpsAggregates> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    getOrgAggregatesWithTx(tx, ctx.orgId, {
      surveyId: ctx.surveyId ?? null,
      sinceDays: ctx.sinceDays ?? 0,
    }),
  );
}
