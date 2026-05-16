import 'server-only';

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { type AnyPgTx, dbAdmin, dbAs } from '../db/client';
import {
  auditEvents,
  brands,
  locations,
  reviewRequests,
} from '../db/schema';
import { sendEmail } from '../emails/send';
import { AppError } from '../errors';
import { type PlanCode } from '../plans/plans';
import { checkUsage, incrementUsage } from '../usage/counters';
import { err, ok, type Result } from '../types/result';

import { generateRequestToken } from './request-tokens';

/**
 * Outbound review-request orchestrator (Commit 16).
 *
 * Three branches:
 *
 *   - `sendReviewRequest`     — single recipient. Returns
 *                              `DUPLICATE_REVIEW_REQUEST` when the
 *                              same (org, location, email) was sent
 *                              in the last 30 days with status
 *                              still pending. Plan-limit gate via
 *                              `checkUsage(reviewRequestsPerMonth)`
 *                              fires first.
 *   - `sendReviewRequestsBulk` — batch. Iterates the unique recipient
 *                              list and skips duplicates rather than
 *                              failing the whole batch. Returns a
 *                              summary `{ sent, skipped, limited }`.
 *   - `cancelReviewRequest`   — marks a request as outcome
 *                              `no_response` and stamps completed.
 *                              Used when a manager invalidates a
 *                              previously-sent prompt.
 *
 * All paths go through `dbAs` so RLS enforces tenancy. `dbAdmin` is
 * ONLY used for audit-event writes (same trade-off as Phase 4 inbox;
 * tracked at TODO.md#audit-events-atomicity). The public token
 * resolver lives elsewhere — see `public-feedback.ts`.
 *
 * Audit events:
 *
 *   - `review.request.sent`       — per inserted request row.
 *   - `review.request.skipped_dup`— per recipient that hit the
 *                                   30-day dedup window.
 *   - `review.request.plan_limit` — when the org's monthly cap was
 *                                   hit mid-batch. Single-recipient
 *                                   callers get the AppError
 *                                   directly.
 *   - `review.request.cancelled`  — per cancellation.
 */

// ---------------------------------------------------------------------------
// DI seam for tests (mirrors send-reply.ts / send-response.ts)
// ---------------------------------------------------------------------------

export interface RequestDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  /** Email transport — Resend in Phase 11 swaps the body of `sendEmail`. */
  sendEmail: typeof sendEmail;
  /** Token minter — injectable so tests can pin determinism. */
  generateToken: typeof generateRequestToken;
  /** Wall-clock injection so dedup-window tests can pin "now". */
  now: () => Date;
}

const defaultDeps: RequestDeps = {
  asUser: (ctx, fn) => dbAs(ctx, fn),
  asAdmin: (fn) => dbAdmin(fn),
  sendEmail,
  generateToken: generateRequestToken,
  now: () => new Date(),
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const DEDUP_WINDOW_DAYS = 30;

const recipientSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(120).optional(),
});

export type Recipient = z.infer<typeof recipientSchema>;

const singleInputSchema = z.object({
  brandId: z.string().uuid(),
  locationId: z.string().uuid(),
  recipient: recipientSchema,
});

export type SendRequestInput = z.infer<typeof singleInputSchema>;

export interface SendRequestSuccess {
  readonly requestId: string;
  readonly token: string;
}

export interface BulkSendInput {
  readonly brandId: string;
  readonly locationId: string;
  readonly recipients: ReadonlyArray<Recipient>;
}

export interface BulkSendSummary {
  readonly sent: ReadonlyArray<{ email: string; requestId: string }>;
  readonly skipped: ReadonlyArray<{ email: string; reason: 'duplicate'; existingRequestId: string }>;
  readonly limited: ReadonlyArray<{ email: string; reason: 'plan_limit' }>;
}

// ---------------------------------------------------------------------------
// Single-recipient send
// ---------------------------------------------------------------------------

export async function sendReviewRequest(
  ctx: { orgId: string; userId: string; plan: PlanCode },
  input: SendRequestInput,
  deps: RequestDeps = defaultDeps,
): Promise<Result<SendRequestSuccess>> {
  const parsed = singleInputSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos de solicitud inválidos.');
  }

  // Plan limit gate — check usage BEFORE we burn a duplicate-check
  // round-trip. The check is dirty (not locked) which is fine for a
  // monthly cap; a brief race past the cap by 1 is acceptable, and
  // Phase 11 with Supabase + Edge will move the cap to a row-locked
  // upsert.
  const limitCheck = await deps.asUser(
    { orgId: ctx.orgId, userId: ctx.userId },
    (tx) => checkUsage(tx, ctx.orgId, ctx.plan, 'reviewRequestsPerMonth', 1),
  );
  if (!limitCheck.ok) {
    return err('PLAN_LIMIT_REACHED', 'Alcanzaste el cupo mensual de solicitudes de reseña.', {
      meta: { current: limitCheck.current, cap: limitCheck.cap },
    });
  }

  // Dedup check.
  const existing = await findExistingPendingRequest(deps, ctx.orgId, ctx.userId, {
    locationId: parsed.data.locationId,
    email: parsed.data.recipient.email.toLowerCase(),
    now: deps.now(),
  });
  if (existing) {
    return err(
      'DUPLICATE_REVIEW_REQUEST',
      `Ya enviaste una solicitud a este email hace menos de ${DEDUP_WINDOW_DAYS} días.`,
      { meta: { existingRequestId: existing.id, sentAt: existing.sentAt } },
    );
  }

  // Insert + audit + email.
  const result = await insertAndDispatch(deps, ctx, parsed.data);
  return ok(result);
}

// ---------------------------------------------------------------------------
// Bulk send
// ---------------------------------------------------------------------------

export async function sendReviewRequestsBulk(
  ctx: { orgId: string; userId: string; plan: PlanCode },
  input: BulkSendInput,
  deps: RequestDeps = defaultDeps,
): Promise<Result<BulkSendSummary>> {
  if (input.recipients.length === 0) {
    return err('VALIDATION_ERROR', 'Sin destinatarios.');
  }
  if (input.recipients.length > 200) {
    return err('VALIDATION_ERROR', 'Máximo 200 destinatarios por envío bulk.');
  }

  // Dedupe input by email (lowercased). Same email twice in the same
  // batch counts as one logical recipient.
  const byEmail = new Map<string, Recipient>();
  for (const r of input.recipients) {
    const parsed = recipientSchema.safeParse(r);
    if (!parsed.success) continue;
    byEmail.set(parsed.data.email.toLowerCase(), parsed.data);
  }
  const recipients = [...byEmail.values()];

  const sent: Array<{ email: string; requestId: string }> = [];
  const skipped: Array<{ email: string; reason: 'duplicate'; existingRequestId: string }> = [];
  const limited: Array<{ email: string; reason: 'plan_limit' }> = [];

  for (const recipient of recipients) {
    // Plan-limit check per iteration so a batch that crosses the cap
    // mid-way stops cleanly.
    const limitCheck = await deps.asUser(
      { orgId: ctx.orgId, userId: ctx.userId },
      (tx) => checkUsage(tx, ctx.orgId, ctx.plan, 'reviewRequestsPerMonth', 1),
    );
    if (!limitCheck.ok) {
      limited.push({ email: recipient.email, reason: 'plan_limit' });
      await writeAudit(deps, ctx, {
        action: 'review.request.plan_limit',
        entityType: 'organization',
        entityId: ctx.orgId,
        after: { email: recipient.email, current: limitCheck.current, cap: limitCheck.cap },
        riskLevel: 'medium',
      });
      continue;
    }
    const existing = await findExistingPendingRequest(deps, ctx.orgId, ctx.userId, {
      locationId: input.locationId,
      email: recipient.email.toLowerCase(),
      now: deps.now(),
    });
    if (existing) {
      skipped.push({
        email: recipient.email,
        reason: 'duplicate',
        existingRequestId: existing.id,
      });
      await writeAudit(deps, ctx, {
        action: 'review.request.skipped_dup',
        entityType: 'review_request',
        entityId: existing.id,
        after: { email: recipient.email, existingSentAt: existing.sentAt },
        riskLevel: 'low',
      });
      continue;
    }
    const dispatched = await insertAndDispatch(deps, ctx, {
      brandId: input.brandId,
      locationId: input.locationId,
      recipient,
    });
    sent.push({ email: recipient.email, requestId: dispatched.requestId });
  }

  return ok({ sent, skipped, limited });
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelReviewRequest(
  ctx: { orgId: string; userId: string },
  requestId: string,
  deps: RequestDeps = defaultDeps,
): Promise<Result<{ requestId: string }>> {
  const rows = await deps.asUser<Array<{ id: string; completedAt: Date | null }>>(
    { orgId: ctx.orgId, userId: ctx.userId },
    (tx) =>
      tx
        .select({ id: reviewRequests.id, completedAt: reviewRequests.completedAt })
        .from(reviewRequests)
        .where(
          and(
            eq(reviewRequests.id, requestId),
            eq(reviewRequests.organizationId, ctx.orgId),
          ),
        )
        .limit(1),
  );
  if (rows.length === 0) return err('NOT_FOUND', 'Solicitud no encontrada.');
  if (rows[0]!.completedAt) {
    return err('CONFLICT', 'Esta solicitud ya está cerrada.');
  }
  await deps.asUser(
    { orgId: ctx.orgId, userId: ctx.userId },
    (tx) =>
      tx
        .update(reviewRequests)
        .set({ completedAt: deps.now(), outcome: 'no_response' })
        .where(eq(reviewRequests.id, requestId)),
  );
  await writeAudit(deps, ctx, {
    action: 'review.request.cancelled',
    entityType: 'review_request',
    entityId: requestId,
    after: { reason: 'manual_cancel' },
    riskLevel: 'low',
  });
  return ok({ requestId });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface DedupQuery {
  locationId: string;
  email: string;
  now: Date;
}

async function findExistingPendingRequest(
  deps: RequestDeps,
  orgId: string,
  userId: string,
  q: DedupQuery,
): Promise<{ id: string; sentAt: Date | null } | null> {
  const dedupSince = new Date(q.now.getTime() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await deps.asUser<Array<{ id: string; sentAt: Date | null }>>(
    { orgId, userId },
    (tx) =>
      tx
        .select({ id: reviewRequests.id, sentAt: reviewRequests.sentAt })
        .from(reviewRequests)
        .where(
          and(
            eq(reviewRequests.organizationId, orgId),
            eq(reviewRequests.locationId, q.locationId),
            // contact_info->>'email' lookup using a jsonb path. Cast
            // to text + LOWER for case-insensitive comparison.
            sql`LOWER(${reviewRequests.contactInfo} ->> 'email') = ${q.email}`,
            gte(reviewRequests.sentAt, dedupSince),
            // Only outstanding requests block — completed ones are
            // archived history and don't dedup.
            sql`${reviewRequests.completedAt} IS NULL`,
          ),
        )
        .limit(1),
  );
  return rows[0] ?? null;
}

interface InsertAndDispatchArgs {
  brandId: string;
  locationId: string;
  recipient: Recipient;
}

async function insertAndDispatch(
  deps: RequestDeps,
  ctx: { orgId: string; userId: string; plan: PlanCode },
  args: InsertAndDispatchArgs,
): Promise<SendRequestSuccess> {
  // Resolve brand + location names for the email + audit payload.
  const meta = await deps.asUser<
    Array<{ brandName: string | null; locationName: string | null; locationCountry: string | null }>
  >({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    tx
      .select({
        brandName: brands.name,
        locationName: locations.name,
        locationCountry: locations.country,
      })
      .from(locations)
      .leftJoin(brands, eq(brands.id, locations.brandId))
      .where(eq(locations.id, args.locationId))
      .limit(1),
  );
  const brandName = meta[0]?.brandName ?? 'tu marca';
  const locationName = meta[0]?.locationName ?? 'nuestra sucursal';
  // Locale detection: explicit recipient locale > location country
  // heuristic. Phase 7 swaps for brand_voice.locale.
  const locale: 'es' | 'en' = meta[0]?.locationCountry === 'US' ? 'en' : 'es';

  const token = deps.generateToken();
  const now = deps.now();
  const expiresAt = new Date(now.getTime() + DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const inserted = await deps.asUser<{ id: string }[]>(
    { orgId: ctx.orgId, userId: ctx.userId },
    async (tx) =>
      tx
        .insert(reviewRequests)
        .values({
          organizationId: ctx.orgId,
          brandId: args.brandId,
          locationId: args.locationId,
          channel: 'email',
          contactInfo: {
            email: args.recipient.email,
            ...(args.recipient.name ? { name: args.recipient.name } : {}),
            locale,
          },
          token,
          sentAt: now,
          expiresAt,
          metadata: { sentBy: ctx.userId },
        })
        .returning({ id: reviewRequests.id }),
  );
  const requestId = inserted[0]!.id;

  // Usage counter lives behind `service_role` writes by design
  // (`usage_counters` only grants SELECT to `authenticated`). Same
  // post-txn admin write pattern as every other counter increment
  // in the project — see `onboarding/start/actions.ts`. Same
  // atomicity caveat: if this fails the request row stays;
  // TODO.md#audit-events-atomicity tracks the Phase-11 merge.
  await deps.asAdmin((tx) =>
    incrementUsage(tx, ctx.orgId, 'reviewRequestsPerMonth', 1),
  );

  // Fire the email through the dev outbox / Resend (Phase 11).
  const feedbackUrl = `${publicBaseUrl()}/feedback/${token}`;
  const subject = locale === 'en'
    ? `${brandName} — how was your visit to ${locationName}?`
    : `${brandName} — ¿cómo fue tu visita a ${locationName}?`;
  const body = locale === 'en'
    ? `Hi${args.recipient.name ? ' ' + args.recipient.name : ''},\n\n` +
      `Thanks for visiting ${locationName}. We'd love a quick rating:\n${feedbackUrl}\n\n` +
      `It takes under 30 seconds. — ${brandName}`
    : `Hola${args.recipient.name ? ' ' + args.recipient.name : ''},\n\n` +
      `Gracias por visitar ${locationName}. Nos encantaría saber cómo fue:\n${feedbackUrl}\n\n` +
      `Toma menos de 30 segundos. — ${brandName}`;
  await deps.sendEmail({
    kind: 'review_request',
    to: args.recipient.email,
    subject,
    text: body,
    meta: { requestId, brandId: args.brandId, locationId: args.locationId },
  });

  await writeAudit(deps, ctx, {
    action: 'review.request.sent',
    entityType: 'review_request',
    entityId: requestId,
    after: {
      brandId: args.brandId,
      locationId: args.locationId,
      email: args.recipient.email,
      tokenPrefix: token.slice(0, 8),
      locale,
    },
    riskLevel: 'low',
  });

  return { requestId, token };
}

interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  riskLevel?: string;
}

async function writeAudit(
  deps: RequestDeps,
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
      'Failed to write audit event for review request.',
      { cause, meta: { action: input.action } },
    );
  }
}

function publicBaseUrl(): string {
  return process.env.BLACKNEL_PUBLIC_URL ?? 'http://localhost:3000';
}

// Keep `inArray` import live for any future bulk-fetch helper paths
// the cancel/resend flow may grow.
void inArray;
