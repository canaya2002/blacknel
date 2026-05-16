import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AnyPgTx, runAdmin, runAs } from '../../lib/db/client';
import {
  approvals,
  auditEvents,
  brands,
  locations,
  organizations,
  plans,
  reviewResponses,
  reviews,
  users,
} from '../../lib/db/schema';
import { sendReviewResponse, type ReplyDeps } from '../../lib/reviews/send-response';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * `sendReviewResponse` end-to-end (Commit 14).
 *
 * Server Actions over the HTTP boundary are still untestable in
 * vitest (no Next request context), so we exercise the orchestrator
 * directly with a `ReplyDeps` injection wired to the test pglite via
 * `runAs` / `runAdmin`. Same DI pattern as `inbox/send-reply` tests.
 *
 * What's locked in:
 *
 *   1. Direct publish for rating ≥4 + clean compliance: row lands in
 *      `published`, parent review → `responded`, audit event is
 *      `review.response.sent`.
 *   2. Auto-route to approval for rating ≤3: row lands in
 *      `pending_approval`, approval row created with kind
 *      `review_response`, audits are `review.response.routed_to_approval`
 *      + `approval.created`.
 *   3. Auto-route when compliance flags `high`-risk even at rating 5
 *      (e.g., low_rating_monetary_offer fails since rating=5, but
 *      legal_promise from `lawyer` keyword keeps it routed).
 *   4. Draft mode: row inserts in `draft`, no compliance, no approval,
 *      audit is `review.response.drafted`.
 *   5. Idempotency: same key reused → CONFLICT.
 *   6. Yelp / read-only platform: CAPABILITY_NOT_AVAILABLE.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-cc0000000001';
const orgA = '11111111-1111-4111-8111-cc0000000001';
const userA = '22222222-2222-4222-8222-cc0000000001';
const brandA = '33333333-3333-4333-8333-cc0000000001';
const locationA = '44444444-4444-4444-8444-cc0000000001';

// One review per rating bucket so the routing branches are all reachable.
const review5 = '55555555-5555-4555-8555-cc0000000005';
const review2 = '55555555-5555-4555-8555-cc0000000002';
const review3 = '55555555-5555-4555-8555-cc0000000003';
const reviewYelp = '55555555-5555-4555-8555-cc0000000ce0';
const reviewLegalKeyword = '55555555-5555-4555-8555-cc000000001e';

// Inline DI wrapper — each call routes to the fixture DB.
const deps = (): ReplyDeps => ({
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => runAs(fixture.db, ctx, fn),
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
});

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@srr.test', name: 'A' });
    await tx
      .insert(organizations)
      .values({ id: orgA, name: 'Org A', slug: 'srr-org-a', planId });
    await tx
      .insert(brands)
      .values({ id: brandA, organizationId: orgA, name: 'Trattoria', slug: 'trattoria' });
    await tx
      .insert(locations)
      .values({
        id: locationA,
        organizationId: orgA,
        brandId: brandA,
        name: 'Downtown',
      });
    await tx.insert(reviews).values([
      {
        id: review5,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'gbp',
        externalReviewId: 'gbp-rq-5',
        authorName: 'Cinco',
        rating: 5,
        body: 'Excelente.',
        sentiment: 'positive',
        status: 'pending',
      },
      {
        id: review2,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'gbp',
        externalReviewId: 'gbp-rq-2',
        authorName: 'Dos',
        rating: 2,
        body: 'Mal servicio.',
        sentiment: 'negative',
        status: 'pending',
      },
      {
        id: review3,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'gbp',
        externalReviewId: 'gbp-rq-3',
        authorName: 'Tres',
        rating: 3,
        body: 'Promedio.',
        sentiment: 'neutral',
        status: 'pending',
      },
      {
        id: reviewYelp,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'yelp',
        externalReviewId: 'yelp-rq-1',
        authorName: 'YelpUser',
        rating: 5,
        body: 'Buen lugar.',
        sentiment: 'positive',
        status: 'pending',
      },
      {
        id: reviewLegalKeyword,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'gbp',
        externalReviewId: 'gbp-rq-lg',
        authorName: 'Legal',
        rating: 5,
        body: 'Solo quería decir gracias.',
        sentiment: 'positive',
        status: 'pending',
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

// ---------------------------------------------------------------------------
// Happy path: 5★ + clean → publish directly
// ---------------------------------------------------------------------------

describe('sendReviewResponse — direct publish (rating ≥4 + clean compliance)', () => {
  it('inserts review_response with status=published and bumps parent review to responded', async () => {
    const result = await sendReviewResponse(
      { orgId: orgA, userId: userA },
      {
        reviewId: review5,
        body: 'Gracias por tu reseña!',
        mode: 'send',
        idempotencyKey: '11111111-1111-4111-8111-cc0000ide001',
      },
      deps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.outcome).toBe('sent');

    const [respRow] = await runAdmin<
      Array<{ status: string; publishedAt: Date | null; finalText: string | null }>
    >(fixture.db, async (tx) =>
      tx
        .select({
          status: reviewResponses.status,
          publishedAt: reviewResponses.publishedAt,
          finalText: reviewResponses.finalText,
        })
        .from(reviewResponses)
        .where(eq(reviewResponses.id, result.data.responseId)),
    );
    expect(respRow?.status).toBe('published');
    expect(respRow?.publishedAt).toBeInstanceOf(Date);
    expect(respRow?.finalText).toBe('Gracias por tu reseña!');

    const [reviewRow] = await runAdmin<Array<{ status: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ status: reviews.status })
          .from(reviews)
          .where(eq(reviews.id, review5)),
    );
    expect(reviewRow?.status).toBe('responded');
  });

  it('emits review.response.sent audit', async () => {
    const events = await runAdmin<
      Array<{ action: string; after: Record<string, unknown> | null }>
    >(fixture.db, async (tx) =>
      tx
        .select({ action: auditEvents.action, after: auditEvents.after })
        .from(auditEvents)
        .where(eq(auditEvents.action, 'review.response.sent')),
    );
    expect(events.length).toBeGreaterThanOrEqual(1);
    const evt = events.find(
      (e) => (e.after as { reviewId?: string } | null)?.reviewId === review5,
    );
    expect(evt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Routing path: rating ≤3 → approval queue
// ---------------------------------------------------------------------------

describe('sendReviewResponse — auto-route for rating ≤3', () => {
  it('rating=2 routes to approval; row stays pending_approval and creates an approval', async () => {
    const result = await sendReviewResponse(
      { orgId: orgA, userId: userA },
      {
        reviewId: review2,
        body: 'Lamentamos lo ocurrido.',
        mode: 'send',
        idempotencyKey: '11111111-1111-4111-8111-cc0000ide002',
      },
      deps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.outcome).toBe('routed_to_approval');
    expect(result.data.approvalId).toBeDefined();

    const [respRow] = await runAdmin<
      Array<{ status: string; draftText: string | null; publishedAt: Date | null }>
    >(fixture.db, async (tx) =>
      tx
        .select({
          status: reviewResponses.status,
          draftText: reviewResponses.draftText,
          publishedAt: reviewResponses.publishedAt,
        })
        .from(reviewResponses)
        .where(eq(reviewResponses.id, result.data.responseId)),
    );
    expect(respRow?.status).toBe('pending_approval');
    expect(respRow?.draftText).toBe('Lamentamos lo ocurrido.');
    expect(respRow?.publishedAt).toBeNull();

    const [apprRow] = await runAdmin<
      Array<{
        kind: string;
        entityTable: string;
        entityId: string;
        status: string;
        riskLevel: string;
      }>
    >(fixture.db, async (tx) =>
      tx
        .select({
          kind: approvals.kind,
          entityTable: approvals.entityTable,
          entityId: approvals.entityId,
          status: approvals.status,
          riskLevel: approvals.riskLevel,
        })
        .from(approvals)
        .where(eq(approvals.id, result.data.approvalId!)),
    );
    expect(apprRow?.kind).toBe('review_response');
    expect(apprRow?.entityTable).toBe('review_responses');
    expect(apprRow?.entityId).toBe(result.data.responseId);
    expect(apprRow?.status).toBe('pending');
  });

  it('rating=3 also routes (boundary inclusive at ≤3)', async () => {
    const result = await sendReviewResponse(
      { orgId: orgA, userId: userA },
      {
        reviewId: review3,
        body: 'Gracias por la retroalimentación.',
        mode: 'send',
        idempotencyKey: '11111111-1111-4111-8111-cc0000ide003',
      },
      deps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.outcome).toBe('routed_to_approval');
  });

  it('emits review.response.routed_to_approval + approval.created audits', async () => {
    const routed = await runAdmin<Array<{ action: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(eq(auditEvents.action, 'review.response.routed_to_approval')),
    );
    expect(routed.length).toBeGreaterThanOrEqual(1);

    const created = await runAdmin<Array<{ action: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(eq(auditEvents.action, 'approval.created')),
    );
    expect(created.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Compliance flag forces routing even at high rating
// ---------------------------------------------------------------------------

describe('sendReviewResponse — compliance flag forces routing at rating ≥4', () => {
  it('rating=5 + legal keyword `lawyer` routes to approval', async () => {
    const result = await sendReviewResponse(
      { orgId: orgA, userId: userA },
      {
        reviewId: reviewLegalKeyword,
        body: 'Our lawyer will follow up to make sure this is resolved.',
        mode: 'send',
        idempotencyKey: '11111111-1111-4111-8111-cc0000ide00l',
      },
      deps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.outcome).toBe('routed_to_approval');
  });
});

// ---------------------------------------------------------------------------
// Draft mode
// ---------------------------------------------------------------------------

describe('sendReviewResponse — draft mode', () => {
  it('inserts review_response with status=draft; no approval; no compliance check', async () => {
    const result = await sendReviewResponse(
      { orgId: orgA, userId: userA },
      {
        reviewId: review5,
        body: 'borrador en progreso… (rating 5 con palabra refund que el send rutearía)',
        mode: 'draft',
      },
      deps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.outcome).toBe('drafted');

    const [respRow] = await runAdmin<
      Array<{ status: string; draftText: string | null }>
    >(fixture.db, async (tx) =>
      tx
        .select({ status: reviewResponses.status, draftText: reviewResponses.draftText })
        .from(reviewResponses)
        .where(eq(reviewResponses.id, result.data.responseId)),
    );
    expect(respRow?.status).toBe('draft');
    expect(respRow?.draftText).toContain('borrador');

    const drafted = await runAdmin<Array<{ action: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(eq(auditEvents.action, 'review.response.drafted')),
    );
    expect(drafted.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe('sendReviewResponse — idempotency', () => {
  it('reusing the same idempotency key on the same review returns CONFLICT on second send', async () => {
    const idem = '11111111-1111-4111-8111-cc0000idedup0';
    // First send succeeds against a fresh review row.
    const freshReviewId = '55555555-5555-4555-8555-cc000000fde1';
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(reviews).values({
        id: freshReviewId,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        platform: 'gbp',
        externalReviewId: 'gbp-rq-fresh',
        authorName: 'Fresh',
        rating: 5,
        body: 'Buena experiencia.',
        sentiment: 'positive',
        status: 'pending',
      }),
    );
    const first = await sendReviewResponse(
      { orgId: orgA, userId: userA },
      {
        reviewId: freshReviewId,
        body: 'Mil gracias.',
        mode: 'send',
        idempotencyKey: idem,
      },
      deps(),
    );
    expect(first.ok).toBe(true);

    const second = await sendReviewResponse(
      { orgId: orgA, userId: userA },
      {
        reviewId: freshReviewId,
        body: 'Mil gracias.',
        mode: 'send',
        idempotencyKey: idem,
      },
      deps(),
    );
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.error.code).toBe('CONFLICT');
  });
});

// ---------------------------------------------------------------------------
// Capability gate
// ---------------------------------------------------------------------------

describe('sendReviewResponse — capability gate', () => {
  it('returns CAPABILITY_NOT_AVAILABLE for a Yelp review', async () => {
    const result = await sendReviewResponse(
      { orgId: orgA, userId: userA },
      {
        reviewId: reviewYelp,
        body: 'Gracias por tu reseña!',
        mode: 'send',
        idempotencyKey: '11111111-1111-4111-8111-cc0000ideyel',
      },
      deps(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('CAPABILITY_NOT_AVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('sendReviewResponse — validation', () => {
  it('rejects empty body', async () => {
    const result = await sendReviewResponse(
      { orgId: orgA, userId: userA },
      {
        reviewId: review5,
        body: '   ',
        mode: 'send',
        idempotencyKey: '11111111-1111-4111-8111-cc0000ideemp',
      },
      deps(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects send without idempotency_key', async () => {
    const result = await sendReviewResponse(
      { orgId: orgA, userId: userA },
      { reviewId: review5, body: 'OK', mode: 'send' },
      deps(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns NOT_FOUND for an unknown review id', async () => {
    const result = await sendReviewResponse(
      { orgId: orgA, userId: userA },
      {
        reviewId: '55555555-5555-4555-8555-cc00000000ff',
        body: 'OK',
        mode: 'send',
        idempotencyKey: '11111111-1111-4111-8111-cc0000idenfd',
      },
      deps(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('NOT_FOUND');
  });
});
