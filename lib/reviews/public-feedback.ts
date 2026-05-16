import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin } from '../db/client';
import {
  auditEvents,
  brands,
  locations,
  reviewRequests,
  reviews,
} from '../db/schema';
import { log } from '../log';
import { err, ok, type Result } from '../types/result';

import { validateTokenFormat } from './request-tokens';

/**
 * Dependency seam for tests. Production code passes nothing and uses
 * `dbAdmin` directly; integration tests pass an `asAdmin` wired to
 * the test pglite via `runAdmin`. The malformed-token short-circuit
 * happens BEFORE `asAdmin` is invoked, so a test using a throwing
 * spy can prove no query was issued for that branch.
 */
export interface FeedbackDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

const defaultDeps: FeedbackDeps = {
  asAdmin: (fn) => dbAdmin(fn),
};

/**
 * SINGLE call-site for `dbAdmin` on the public review-feedback
 * surface. The /feedback/[token] landing has no session — no user,
 * no org — so RLS can't be enforced via `dbAs`. This file is the
 * audited tenant-isolation escape hatch for that one surface.
 *
 * Anything outside this file that touches `reviews` /
 * `review_requests` MUST go through `dbAs` with a session. To verify:
 *
 *     grep -n "dbAdmin" lib/reviews/
 *
 * should return at most this file plus `send-response.ts` (audit
 * writer — different concern, documented at the call site). Adding a
 * second public surface should add an `/* IS PUBLIC SURFACE *\/` JSDoc
 * tag here, not a new dbAdmin import elsewhere.
 *
 * # Timing oracle defense (Commit 16, Ajuste 1)
 *
 * Token enumeration via timing — measuring the latency difference
 * between "token doesn't exist" and "token exists but expired" —
 * is the classic attack against unauthenticated lookup endpoints.
 *
 * Defenses applied here:
 *
 *   1. **Pre-DB shape check.** `validateTokenFormat` runs FIRST.
 *      Malformed tokens never reach the DB. The cost is one regex
 *      + length compare. An attacker spraying random strings sees
 *      uniform sub-millisecond rejection.
 *
 *   2. **Single query for the three "no" branches.** If the format
 *      is valid we run ONE query. Whether the token doesn't exist,
 *      has expired, or has already been completed, the function
 *      returns `null` after the same query. Same latency profile,
 *      same response body, same null discriminant.
 *
 *   3. **No distinguishing error codes.** `loadFeedbackByToken`
 *      returns `null` for all four "you can't proceed" cases.
 *      `submitFeedback` returns the same `Result` shape regardless
 *      of which branch was taken (or doesn't return at all from a
 *      submission against an invalid token — same as load).
 *
 * Future Phase 7+ hardening (deferred):
 *
 *   - Constant-time string comparison on the token vs DB result so
 *     an attacker can't measure HMAC-like differences. Postgres
 *     `=` is already constant-time on TEXT, but if we add an HMAC
 *     wrapper around the token this concern returns. Tracked in
 *     TODO.md#feedback-constant-time once that lands.
 */

export interface FeedbackContext {
  readonly requestId: string;
  readonly organizationId: string;
  readonly brandId: string | null;
  readonly locationId: string | null;
  readonly brandName: string | null;
  readonly locationName: string | null;
  readonly locale: string;
  readonly platform: string | null;
  readonly contactName: string | null;
  readonly publicReviewUrl: string | null;
}

export interface FeedbackOutcome {
  readonly outcome: 'positive_routed' | 'negative_captured';
  /** Set when outcome is `positive_routed`. */
  readonly redirectUrl: string | null;
}

export interface SubmitFeedbackInput {
  readonly token: string;
  readonly rating: number;
  readonly comment: string | null;
}

/**
 * Look up the feedback context for `token`. Returns `null` for every
 * failure case so the timing channel is uniform.
 *
 *   - Token shape invalid     → null, no DB query.
 *   - Token unknown           → null, 1 query.
 *   - Token expired           → null, 1 query.
 *   - Token already completed → null, 1 query.
 *   - Token valid             → FeedbackContext.
 */
export async function loadFeedbackByToken(
  token: unknown,
  deps: FeedbackDeps = defaultDeps,
): Promise<FeedbackContext | null> {
  if (!validateTokenFormat(token)) {
    // Don't even reach the DB. The log line is intentional — an
    // observability dashboard wants to see token-format-rejected
    // spikes (likely enumeration / fuzzing), but the public response
    // is null regardless.
    log.debug({ raw: typeof token === 'string' ? token.slice(0, 8) : null }, 'feedback.token.malformed');
    return null;
  }
  const rows = await deps.asAdmin<
    Array<{
      requestId: string;
      organizationId: string;
      brandId: string | null;
      locationId: string | null;
      brandName: string | null;
      locationName: string | null;
      locale: string | null;
      platform: string | null;
      contactInfo: unknown;
      sentAt: Date | null;
      completedAt: Date | null;
      expiresAt: Date;
    }>
  >(async (tx) =>
    tx
      .select({
        requestId: reviewRequests.id,
        organizationId: reviewRequests.organizationId,
        brandId: reviewRequests.brandId,
        locationId: reviewRequests.locationId,
        brandName: brands.name,
        locationName: locations.name,
        locale: locations.country, // Stand-in until brand_voice carries the locale.
        platform: locations.gbpPlaceId,
        contactInfo: reviewRequests.contactInfo,
        sentAt: reviewRequests.sentAt,
        completedAt: reviewRequests.completedAt,
        expiresAt: reviewRequests.expiresAt,
      })
      .from(reviewRequests)
      .leftJoin(brands, eq(brands.id, reviewRequests.brandId))
      .leftJoin(locations, eq(locations.id, reviewRequests.locationId))
      .where(eq(reviewRequests.token, token))
      .limit(1),
  );

  const row = rows[0];
  if (!row) return null;
  if (row.completedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  const contactInfo =
    row.contactInfo && typeof row.contactInfo === 'object'
      ? (row.contactInfo as Record<string, unknown>)
      : {};
  const contactName =
    typeof contactInfo.name === 'string' && contactInfo.name.length > 0
      ? (contactInfo.name as string)
      : null;
  const detectedLocale =
    typeof contactInfo.locale === 'string' &&
    (contactInfo.locale === 'es' || contactInfo.locale === 'en')
      ? (contactInfo.locale as string)
      : 'es';

  return {
    requestId: row.requestId,
    organizationId: row.organizationId,
    brandId: row.brandId,
    locationId: row.locationId,
    brandName: row.brandName,
    locationName: row.locationName,
    locale: detectedLocale,
    platform: row.platform,
    contactName,
    // The public review URL is derived from the location's connector
    // (gbp_place_id for Google). When unset we fall back to null and
    // the landing's thank-you page omits the redirect CTA.
    publicReviewUrl: row.platform ? buildGooglePlaceReviewUrl(row.platform) : null,
  };
}

/**
 * Process a submission. Same security posture as
 * `loadFeedbackByToken` — every "can't proceed" branch returns
 * `err('NOT_FOUND', ...)` so the response is indistinguishable across
 * malformed / unknown / expired / already-completed tokens.
 *
 * Routing rule:
 *
 *   - rating ≥ 4  → outcome `positive_routed`, set the request to
 *                   completed, redirect URL points to the public
 *                   review platform (Google).
 *   - rating ≤ 3  → outcome `negative_captured`, set the request to
 *                   completed, ALSO insert a placeholder internal
 *                   `reviews` row with `status='pending'` so the
 *                   inbox-of-reviews picks it up for the manager to
 *                   action.
 *
 * Both branches write an `audit_events` row tagged
 * `feedback.received`.
 */
export async function submitFeedback(
  input: SubmitFeedbackInput,
  deps: FeedbackDeps = defaultDeps,
): Promise<Result<FeedbackOutcome>> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return err('VALIDATION_ERROR', 'Rating fuera de rango.');
  }
  const trimmedComment =
    typeof input.comment === 'string' ? input.comment.trim().slice(0, 4000) : '';

  const ctx = await loadFeedbackByToken(input.token, deps);
  if (!ctx) return err('NOT_FOUND', 'Solicitud no encontrada o expirada.');

  const positive = input.rating >= 4;
  const outcome: 'positive_routed' | 'negative_captured' = positive
    ? 'positive_routed'
    : 'negative_captured';

  await deps.asAdmin(async (tx) => {
    // 1. Close the request row regardless of branch.
    // `opened_at` keeps the first non-null timestamp. If the user
    // landed earlier without submitting, the request was already
    // opened; if they hit the page and submit in one go, we stamp
    // it as opened-now alongside the submission.
    await tx
      .update(reviewRequests)
      .set({
        completedAt: new Date(),
        outcome,
        openedAt: sql`COALESCE(${reviewRequests.openedAt}, NOW())`,
      })
      .where(eq(reviewRequests.id, ctx.requestId));

    // 2. Negative branch — capture privately as a pending review for
    //    the manager. Positive branch doesn't insert anything here;
    //    the customer is being redirected to leave a public review
    //    on the platform itself.
    if (!positive) {
      await tx.insert(reviews).values({
        organizationId: ctx.organizationId,
        brandId: ctx.brandId,
        locationId: ctx.locationId,
        platform: 'mock', // placeholder — real platform comes from the eventual public review
        externalReviewId: null,
        authorName: ctx.contactName,
        rating: input.rating,
        body: trimmedComment.length > 0
          ? trimmedComment
          : '(Sin comentario adicional)',
        sentiment: 'negative',
        status: 'pending',
        escalated: true,
        tags: ['feedback-captured'],
        metadata: {
          source: 'review_request',
          requestId: ctx.requestId,
        },
      });
    }

    // 3. Audit.
    await tx.insert(auditEvents).values({
      organizationId: ctx.organizationId,
      userId: null,
      actorType: 'system',
      action: 'feedback.received',
      entityType: 'review_request',
      entityId: ctx.requestId,
      before: null,
      after: {
        rating: input.rating,
        outcome,
        commentLength: trimmedComment.length,
      },
      riskLevel: positive ? 'low' : 'high',
    });
  });

  return ok({
    outcome,
    redirectUrl: positive ? ctx.publicReviewUrl : null,
  });
}

/**
 * Pre-DB shape check exposed for callers that want to short-circuit
 * before importing the heavy dbAdmin path. Same predicate as
 * `request-tokens.validateTokenFormat`; re-exported here to keep
 * the public-surface module's API discoverable.
 */
export { validateTokenFormat };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGooglePlaceReviewUrl(placeId: string): string {
  // The canonical "leave a review" deep link for a Google Business
  // Profile. The placeholder placeId we seed in mocks still produces
  // a well-formed URL — Phase 11 with the real GBP connector swaps
  // the placeholder for a verified place id.
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}
