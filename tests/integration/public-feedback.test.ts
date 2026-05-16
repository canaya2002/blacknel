import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type AnyPgTx, runAdmin } from '../../lib/db/client';
import {
  auditEvents,
  brands,
  locations,
  organizations,
  plans,
  reviewRequests,
  reviews,
  users,
} from '../../lib/db/schema';
import {
  loadFeedbackByToken,
  submitFeedback,
  type FeedbackDeps,
} from '../../lib/reviews/public-feedback';
import { generateRequestToken } from '../../lib/reviews/request-tokens';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Public-feedback contract (Commit 16, Ajuste 1).
 *
 * Locks in:
 *
 *   1. Malformed token → null, NO DB query (spy proves it).
 *   2. Format-valid but unknown token → null, exactly 1 DB query.
 *   3. Format-valid + expired → null, exactly 1 DB query.
 *   4. Format-valid + already completed → null, exactly 1 DB query.
 *   5. Format-valid + active → FeedbackContext.
 *
 * The "exactly 1" assertion is the timing-oracle defense: the three
 * "no" branches all spend the same DB round-trip so an attacker
 * can't distinguish them by latency. Branch (1) skips the DB
 * entirely because the shape check fails up front — also the
 * cheapest defense.
 *
 * Plus the submit-side paths (positive routing, negative capture)
 * with audit row assertions.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-fe0000000a01';
const orgA = '11111111-1111-4111-8111-fe0000000a01';
const userA = '22222222-2222-4222-8222-fe0000000a01';
const brandA = '33333333-3333-4333-8333-fe0000000a01';
const locationA = '44444444-4444-4444-8444-fe0000000a01';

const requestActiveId = '55555555-5555-4555-8555-fe000000a001';
const requestExpiredId = '55555555-5555-4555-8555-fe000000a002';
const requestCompletedId = '55555555-5555-4555-8555-fe000000a003';

let activeToken: string;
let expiredToken: string;
let completedToken: string;

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@pf.test', name: 'A' });
    await tx
      .insert(organizations)
      .values({ id: orgA, name: 'Org A', slug: 'pf-org-a', planId });
    await tx
      .insert(brands)
      .values({ id: brandA, organizationId: orgA, name: 'Trattoria', slug: 'trattoria' });
    await tx.insert(locations).values({
      id: locationA,
      organizationId: orgA,
      brandId: brandA,
      name: 'Downtown',
      country: 'MX',
      gbpPlaceId: 'ChIJ-DemoPlace',
    });

    activeToken = generateRequestToken();
    expiredToken = generateRequestToken();
    completedToken = generateRequestToken();

    const now = new Date();
    const past = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    await tx.insert(reviewRequests).values([
      {
        id: requestActiveId,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        channel: 'email',
        contactInfo: { email: 'cliente@demo.com', name: 'Ana', locale: 'es' },
        token: activeToken,
        sentAt: now,
        expiresAt: future,
      },
      {
        id: requestExpiredId,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        channel: 'email',
        contactInfo: { email: 'expired@demo.com', locale: 'es' },
        token: expiredToken,
        sentAt: past,
        // expires_at is in the past
        expiresAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      },
      {
        id: requestCompletedId,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        channel: 'email',
        contactInfo: { email: 'completed@demo.com', locale: 'es' },
        token: completedToken,
        sentAt: past,
        expiresAt: future,
        completedAt: now,
        outcome: 'positive_routed',
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

function spiedDeps(): { deps: FeedbackDeps; spy: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(
    async <T,>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> => {
      return runAdmin(fixture.db, fn);
    },
  );
  const deps: FeedbackDeps = {
    asAdmin: spy as unknown as FeedbackDeps['asAdmin'],
  };
  return { deps, spy };
}

describe('loadFeedbackByToken — timing-oracle defense', () => {
  it('malformed token → null, ZERO DB queries', async () => {
    const { deps, spy } = spiedDeps();
    const result = await loadFeedbackByToken('not-a-valid-token', deps);
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('non-string token → null, ZERO DB queries', async () => {
    const { deps, spy } = spiedDeps();
    const result = await loadFeedbackByToken(null, deps);
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('format-valid but unknown token → null, exactly 1 DB query', async () => {
    const { deps, spy } = spiedDeps();
    const result = await loadFeedbackByToken(generateRequestToken(), deps);
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('format-valid + expired → null, exactly 1 DB query', async () => {
    const { deps, spy } = spiedDeps();
    const result = await loadFeedbackByToken(expiredToken, deps);
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('format-valid + already completed → null, exactly 1 DB query', async () => {
    const { deps, spy } = spiedDeps();
    const result = await loadFeedbackByToken(completedToken, deps);
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('format-valid + active token → FeedbackContext with hydrated brand / location / contact', async () => {
    const { deps, spy } = spiedDeps();
    const result = await loadFeedbackByToken(activeToken, deps);
    expect(result).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result?.brandName).toBe('Trattoria');
    expect(result?.locationName).toBe('Downtown');
    expect(result?.contactName).toBe('Ana');
    expect(result?.locale).toBe('es');
    expect(result?.publicReviewUrl).toContain('ChIJ-DemoPlace');
  });
});

describe('submitFeedback — routing', () => {
  it('rating ≥4 → positive_routed, redirect URL points to public review platform, no internal review row', async () => {
    // Fresh token so the prior tests don't interfere.
    const token = generateRequestToken();
    const id = '55555555-5555-4555-8555-fe000000a004';
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(reviewRequests).values({
        id,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        channel: 'email',
        contactInfo: { email: 'positive@demo.com', name: 'Pos', locale: 'es' },
        token,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    );
    const { deps } = spiedDeps();
    const result = await submitFeedback(
      { token, rating: 5, comment: '¡Excelente!' },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.outcome).toBe('positive_routed');
    expect(result.data.redirectUrl).toContain('writereview?placeid=');

    // Request row marked completed with the right outcome.
    const [row] = await runAdmin<
      Array<{ completedAt: Date | null; outcome: string | null }>
    >(fixture.db, async (tx) =>
      tx
        .select({
          completedAt: reviewRequests.completedAt,
          outcome: reviewRequests.outcome,
        })
        .from(reviewRequests)
        .where(eq(reviewRequests.id, id)),
    );
    expect(row?.completedAt).toBeInstanceOf(Date);
    expect(row?.outcome).toBe('positive_routed');

    // Audit row stamped.
    const auditRows = await runAdmin<Array<{ action: string; riskLevel: string | null }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ action: auditEvents.action, riskLevel: auditEvents.riskLevel })
          .from(auditEvents)
          .where(eq(auditEvents.entityId, id)),
    );
    expect(auditRows.some((r) => r.action === 'feedback.received')).toBe(true);
  });

  it('rating ≤3 → negative_captured, inserts internal reviews row with feedback-captured tag', async () => {
    const token = generateRequestToken();
    const id = '55555555-5555-4555-8555-fe000000a005';
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(reviewRequests).values({
        id,
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        channel: 'email',
        contactInfo: { email: 'negative@demo.com', name: 'Neg', locale: 'es' },
        token,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    );
    const { deps } = spiedDeps();
    const result = await submitFeedback(
      { token, rating: 2, comment: 'No me gustó la espera.' },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.outcome).toBe('negative_captured');
    expect(result.data.redirectUrl).toBeNull();

    // Internal reviews row created with sentiment=negative, escalated=true,
    // tag='feedback-captured'.
    const inserted = await runAdmin<
      Array<{
        rating: number;
        sentiment: string;
        escalated: boolean;
        tags: unknown;
      }>
    >(fixture.db, async (tx) =>
      tx
        .select({
          rating: reviews.rating,
          sentiment: reviews.sentiment,
          escalated: reviews.escalated,
          tags: reviews.tags,
        })
        .from(reviews)
        .where(eq(reviews.organizationId, orgA)),
    );
    const negativeRow = inserted.find(
      (r) => Array.isArray(r.tags) && (r.tags as string[]).includes('feedback-captured'),
    );
    expect(negativeRow).toBeDefined();
    expect(negativeRow?.rating).toBe(2);
    expect(negativeRow?.sentiment).toBe('negative');
    expect(negativeRow?.escalated).toBe(true);
  });

  it('rejects an invalid rating (0)', async () => {
    const { deps } = spiedDeps();
    const result = await submitFeedback(
      { token: activeToken, rating: 0, comment: null },
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns NOT_FOUND for malformed tokens (same response as expired/unknown)', async () => {
    const { deps } = spiedDeps();
    const result = await submitFeedback(
      { token: 'garbage', rating: 5, comment: null },
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('NOT_FOUND');
  });
});
