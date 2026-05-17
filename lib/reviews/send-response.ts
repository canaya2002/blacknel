import 'server-only';

import { and, eq } from 'drizzle-orm';

import { checkCompliance } from '../ai/skills/compliance';
import { type AnyPgTx, dbAdmin, dbAs } from '../db/client';

import type { ComplianceResult } from '../ai/compliance-stub';
import {
  approvals,
  auditEvents,
  brands,
  locations,
  reviewResponses,
  reviews,
} from '../db/schema';
import { AppError } from '../errors';
import { err, ok, type Result } from '../types/result';

/**
 * Single funnel for outbound review responses, mirroring
 * `lib/inbox/send-reply.ts` (Commit 9). Three modes:
 *
 *   - `mode: 'draft'`    → persist a `review_responses` row in
 *                          status='draft'. No compliance check. No
 *                          approval. The composer's "Guardar borrador"
 *                          button calls this.
 *   - `mode: 'send'`     → run compliance + rating gate. If either
 *                          forces approval, route. Otherwise publish.
 *
 * # Branching for `send`
 *
 *   1. RLS-checked review fetch (must belong to caller's org, must
 *      have a connector that supports `reply_reviews` — Yelp gets
 *      rejected with `CAPABILITY_NOT_AVAILABLE`).
 *   2. `complianceCheck(text, { entityType: 'review', rating, brandName,
 *      locationName })`. The Phase-5 review context unlocks the three
 *      extra signals from Ajuste 2 (low-rating monetary offer, named
 *      person outside allowlist, long response).
 *   3. Routing rule:
 *        - rating ≤ 3                       → ALWAYS route to approval
 *        - compliance.riskLevel ∈ {high, critical}  → route
 *        - compliance.requiresApproval=true → route
 *        - otherwise                         → publish directly
 *   4. Insert `review_responses` row:
 *        - direct send: status='published', publishedAt=now,
 *          finalText=body; update parent review.status='responded'.
 *        - routed:      status='pending_approval', draftText=body;
 *          insert `approvals` row referencing the response by id;
 *          `entity_id` of the approval IS the review_responses.id, so
 *          the dispatcher just transitions status in place. No
 *          pre-generated UUID dance like inbox does (inbox doesn't
 *          create the message until approval; we do create the
 *          response row up front because review_responses carries the
 *          idempotency key + compliance score + ai_generated flag the
 *          approval queue surface needs to display).
 *   5. Audit each branch with the events from Ajuste 3:
 *        - `review.response.sent` (direct publish)
 *        - `review.response.routed_to_approval` (approval queued)
 *        - `review.response.drafted` (`mode: 'draft'`)
 *
 * Audit writes use `dbAdmin` outside the main txn — same trade-off as
 * inbox + approvals: a missing audit row is recoverable, a partial
 * publish is not. Tracked in TODO.md#audit-events-atomicity.
 *
 * `idempotencyKey` is required for `mode: 'send'`. The partial unique
 * index on `(review_id, idempotency_key)` prevents a retried action
 * from publishing twice; the second attempt raises a Postgres unique
 * violation we surface as a CONFLICT.
 */

export interface ReplyDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

const defaultDeps: ReplyDeps = {
  asUser: (ctx, fn) => dbAs(ctx, fn),
  asAdmin: (fn) => dbAdmin(fn),
};

const REPLY_CAPABLE_PLATFORMS = new Set<string>([
  'facebook',
  'instagram',
  'gbp',
  'tripadvisor',
  'trustpilot',
  'bbb',
  'avvo',
  'youtube',
]);

const RATING_APPROVAL_THRESHOLD = 3;

export type ResponseMode = 'draft' | 'send';

export interface SendResponseInput {
  readonly reviewId: string;
  readonly body: string;
  readonly aiGenerated?: boolean;
  readonly mode: ResponseMode;
  /** Required when `mode==='send'`. Ignored otherwise. */
  readonly idempotencyKey?: string;
}

export interface SendResponseSuccess {
  readonly outcome: 'drafted' | 'sent' | 'routed_to_approval';
  readonly responseId: string;
  readonly approvalId?: string;
}

export async function sendReviewResponse(
  ctx: { orgId: string; userId: string },
  input: SendResponseInput,
  deps: ReplyDeps = defaultDeps,
): Promise<Result<SendResponseSuccess>> {
  const trimmed = input.body.trim();
  if (trimmed.length === 0) {
    return err('VALIDATION_ERROR', 'La respuesta está vacía.');
  }
  if (trimmed.length > 4000) {
    return err('VALIDATION_ERROR', 'La respuesta supera el máximo permitido.');
  }
  if (input.mode === 'send' && (!input.idempotencyKey || input.idempotencyKey.length === 0)) {
    return err('VALIDATION_ERROR', 'Falta idempotency_key para enviar.');
  }

  // ---- 1. Load review + brand + location ----
  const reviewRows = await deps.asUser<
    Array<{
      id: string;
      platform: string;
      rating: number;
      status: string;
      brandName: string | null;
      locationName: string | null;
    }>
  >({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) =>
    tx
      .select({
        id: reviews.id,
        platform: reviews.platform,
        rating: reviews.rating,
        status: reviews.status,
        brandName: brands.name,
        locationName: locations.name,
      })
      .from(reviews)
      .leftJoin(brands, eq(brands.id, reviews.brandId))
      .leftJoin(locations, eq(locations.id, reviews.locationId))
      .where(
        and(
          eq(reviews.id, input.reviewId),
          eq(reviews.organizationId, ctx.orgId),
        ),
      )
      .limit(1),
  );
  if (reviewRows.length === 0) {
    return err('NOT_FOUND', 'Review no encontrada.');
  }
  const review = reviewRows[0]!;

  // Yelp et al. — declared `read_reviews` only, no `reply_reviews`.
  // Server rejects defensively; UI also hides the composer.
  if (!REPLY_CAPABLE_PLATFORMS.has(review.platform)) {
    return err(
      'CAPABILITY_NOT_AVAILABLE',
      `${review.platform.toUpperCase()} no permite responder reseñas desde Blacknel.`,
      { meta: { platform: review.platform } },
    );
  }

  // ---- 2. Draft mode short-circuits compliance + approvals ----
  if (input.mode === 'draft') {
    return draftResponse(deps, ctx, {
      reviewId: review.id,
      body: trimmed,
      aiGenerated: input.aiGenerated ?? false,
    });
  }

  // ---- 3. Compliance check (Commit 23 — async via aiClient + cascade) ----
  const complianceResponse = await checkCompliance({
    text: trimmed,
    context: {
      orgId: ctx.orgId,
      userId: ctx.userId,
      actorType: 'user',
      entityType: 'review',
      entityId: review.id,
    },
    complianceContext: {
      entityType: 'review',
      rating: review.rating,
      brandName: review.brandName ?? undefined,
      locationName: review.locationName ?? undefined,
    },
  });
  const compliance = complianceResponse.result;

  // Phase-4 stub never returns safe=false; wired for Phase-7's
  // critical-class block-on-content path.
  if (!compliance.safe) {
    return err(
      'AI_COMPLIANCE_VIOLATION',
      'El contenido fue bloqueado por reglas de compliance.',
      { meta: { flags: compliance.flags } },
    );
  }

  const shouldRoute =
    review.rating <= RATING_APPROVAL_THRESHOLD ||
    compliance.requiresApproval ||
    compliance.riskLevel === 'high' ||
    compliance.riskLevel === 'critical';

  if (shouldRoute) {
    return routeToApproval(deps, ctx, {
      reviewId: review.id,
      reviewRating: review.rating,
      body: trimmed,
      aiGenerated: input.aiGenerated ?? false,
      idempotencyKey: input.idempotencyKey!,
      compliance,
    });
  }

  return publishDirect(deps, ctx, {
    reviewId: review.id,
    reviewStatus: review.status,
    body: trimmed,
    aiGenerated: input.aiGenerated ?? false,
    idempotencyKey: input.idempotencyKey!,
    compliance,
  });
}

// ---------------------------------------------------------------------------
// Branch implementations
// ---------------------------------------------------------------------------

interface DraftArgs {
  reviewId: string;
  body: string;
  aiGenerated: boolean;
}

async function draftResponse(
  deps: ReplyDeps,
  ctx: { orgId: string; userId: string },
  args: DraftArgs,
): Promise<Result<SendResponseSuccess>> {
  const inserted = await deps.asUser<{ id: string }[]>(
    { orgId: ctx.orgId, userId: ctx.userId },
    async (tx) =>
      tx
        .insert(reviewResponses)
        .values({
          organizationId: ctx.orgId,
          reviewId: args.reviewId,
          draftText: args.body,
          finalText: null,
          status: 'draft',
          authorId: ctx.userId,
          aiGenerated: args.aiGenerated,
        })
        .returning({ id: reviewResponses.id }),
  );
  const responseId = inserted[0]!.id;
  await writeAudit(deps, ctx, {
    action: 'review.response.drafted',
    entityType: 'review_response',
    entityId: responseId,
    after: {
      reviewId: args.reviewId,
      bodyLength: args.body.length,
      aiGenerated: args.aiGenerated,
    },
    riskLevel: 'low',
  });
  return ok({ outcome: 'drafted', responseId });
}

interface PublishDirectArgs {
  reviewId: string;
  reviewStatus: string;
  body: string;
  aiGenerated: boolean;
  idempotencyKey: string;
  compliance: ComplianceResult;
}

async function publishDirect(
  deps: ReplyDeps,
  ctx: { orgId: string; userId: string },
  args: PublishDirectArgs,
): Promise<Result<SendResponseSuccess>> {
  let responseId: string;
  try {
    const inserted = await deps.asUser<{ id: string }[]>(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        const now = new Date();
        const out = await tx
          .insert(reviewResponses)
          .values({
            organizationId: ctx.orgId,
            reviewId: args.reviewId,
            draftText: null,
            finalText: args.body,
            status: 'published',
            authorId: ctx.userId,
            aiGenerated: args.aiGenerated,
            publishedAt: now,
            idempotencyKey: args.idempotencyKey,
          })
          .returning({ id: reviewResponses.id });
        await tx
          .update(reviews)
          .set({ status: 'responded' })
          .where(
            and(
              eq(reviews.id, args.reviewId),
              eq(reviews.organizationId, ctx.orgId),
            ),
          );
        return out;
      },
    );
    responseId = inserted[0]!.id;
  } catch (e) {
    // Idempotency: the partial unique index on
    // (review_id, idempotency_key) fires here when the same key is
    // reused (retry storm, double-click). We surface as CONFLICT.
    const msg = (e as Error).message ?? '';
    if (msg.includes('review_responses_review_idempotency_unique')) {
      return err('CONFLICT', 'Esta respuesta ya fue enviada.', {
        meta: { idempotencyKey: args.idempotencyKey },
      });
    }
    throw e;
  }

  await writeAudit(deps, ctx, {
    action: 'review.response.sent',
    entityType: 'review_response',
    entityId: responseId,
    after: {
      reviewId: args.reviewId,
      bodyLength: args.body.length,
      aiGenerated: args.aiGenerated,
      complianceFlags: args.compliance.flags,
    },
    riskLevel: args.compliance.riskLevel,
  });

  return ok({ outcome: 'sent', responseId });
}

interface RouteArgs {
  reviewId: string;
  reviewRating: number;
  body: string;
  aiGenerated: boolean;
  idempotencyKey: string;
  compliance: ComplianceResult;
}

async function routeToApproval(
  deps: ReplyDeps,
  ctx: { orgId: string; userId: string },
  args: RouteArgs,
): Promise<Result<SendResponseSuccess>> {
  let responseId: string;
  let approvalId: string;
  try {
    const result = await deps.asUser<{ responseId: string; approvalId: string }>(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) => {
        const respInsert = await tx
          .insert(reviewResponses)
          .values({
            organizationId: ctx.orgId,
            reviewId: args.reviewId,
            draftText: args.body,
            finalText: null,
            status: 'pending_approval',
            authorId: ctx.userId,
            aiGenerated: args.aiGenerated,
            idempotencyKey: args.idempotencyKey,
          })
          .returning({ id: reviewResponses.id });
        const rId = respInsert[0]!.id;

        const apprInsert = await tx
          .insert(approvals)
          .values({
            organizationId: ctx.orgId,
            kind: 'review_response',
            entityTable: 'review_responses',
            // The approval's `entity_id` IS the response row we just
            // created — dispatch only needs to flip its status.
            entityId: rId,
            requestedBy: ctx.userId,
            status: 'pending',
            riskLevel: args.compliance.riskLevel,
            aiRiskFlags: args.compliance.flags as string[],
            proposedPayload: {
              kind: 'review_response',
              reviewId: args.reviewId,
              reviewRating: args.reviewRating,
              responseId: rId,
              body: args.body,
              aiGenerated: args.aiGenerated,
              complianceFlags: args.compliance.flags,
              complianceReasoning: args.compliance.reasoning,
            },
          })
          .returning({ id: approvals.id });
        return { responseId: rId, approvalId: apprInsert[0]!.id };
      },
    );
    responseId = result.responseId;
    approvalId = result.approvalId;
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('review_responses_review_idempotency_unique')) {
      return err('CONFLICT', 'Esta respuesta ya fue enviada.', {
        meta: { idempotencyKey: args.idempotencyKey },
      });
    }
    throw e;
  }

  await writeAudit(deps, ctx, {
    action: 'review.response.routed_to_approval',
    entityType: 'review_response',
    entityId: responseId,
    after: {
      reviewId: args.reviewId,
      reviewRating: args.reviewRating,
      approvalId,
      bodyLength: args.body.length,
      aiGenerated: args.aiGenerated,
      complianceFlags: args.compliance.flags,
      reason:
        args.reviewRating <= RATING_APPROVAL_THRESHOLD
          ? 'low_rating'
          : 'compliance',
    },
    riskLevel: args.compliance.riskLevel,
  });
  await writeAudit(deps, ctx, {
    action: 'approval.created',
    entityType: 'approval',
    entityId: approvalId,
    after: {
      kind: 'review_response',
      reviewId: args.reviewId,
      responseId,
      riskLevel: args.compliance.riskLevel,
    },
    riskLevel: args.compliance.riskLevel,
  });

  return ok({ outcome: 'routed_to_approval', responseId, approvalId });
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  riskLevel?: string;
}

async function writeAudit(
  deps: ReplyDeps,
  ctx: { orgId: string; userId: string },
  input: AuditInput,
): Promise<void> {
  try {
    await deps.asAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: ctx.orgId,
        userId: ctx.userId,
        actorType: 'user',
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before ?? null,
        after: input.after ?? null,
        ...(input.riskLevel ? { riskLevel: input.riskLevel } : {}),
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to write audit event for review response.',
      { cause, meta: { action: input.action } },
    );
  }
}
