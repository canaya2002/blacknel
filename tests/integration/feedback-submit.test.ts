import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import {
  brands,
  locations,
  organizations,
  plans,
  reviewRequests,
  users,
} from '../../lib/db/schema';
import {
  loadFeedbackByToken,
  submitFeedback,
  type FeedbackDeps,
} from '../../lib/reviews/public-feedback';
import {
  createRateLimiter,
  InMemoryRateLimitStore,
} from '../../lib/reviews/rate-limit';
import { generateRequestToken } from '../../lib/reviews/request-tokens';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * End-to-end public flow: generate token → land → submit → confirm
 * the outcome and that the rate-limiter blocks the 6th hit per IP
 * inside a 60s window.
 *
 * The rate limiter is exercised in isolation against the same shape
 * used by `submit-action.ts` so the Phase-11 Upstash swap retains
 * the verified behaviour.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-fe0000000c01';
const orgA = '11111111-1111-4111-8111-fe0000000c01';
const userA = '22222222-2222-4222-8222-fe0000000c01';
const brandA = '33333333-3333-4333-8333-fe0000000c01';
const locationA = '44444444-4444-4444-8444-fe0000000c01';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@fs.test', name: 'A' });
    await tx
      .insert(organizations)
      .values({ id: orgA, name: 'Org A', slug: 'fs-org-a', planId });
    await tx
      .insert(brands)
      .values({ id: brandA, organizationId: orgA, name: 'Trattoria', slug: 'trattoria' });
    await tx.insert(locations).values({
      id: locationA,
      organizationId: orgA,
      brandId: brandA,
      name: 'Downtown',
      country: 'MX',
      gbpPlaceId: 'ChIJ-Demo',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

function fixtureDeps(): FeedbackDeps {
  return {
    asAdmin: (fn) => runAdmin(fixture.db, fn),
  };
}

describe('End-to-end feedback flow', () => {
  it('positive (5★) → routes to public review platform', async () => {
    const token = generateRequestToken();
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(reviewRequests).values({
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        channel: 'email',
        contactInfo: { email: 'positive-e2e@demo.com', locale: 'es' },
        token,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    );
    const ctx = await loadFeedbackByToken(token, fixtureDeps());
    expect(ctx).not.toBeNull();
    const result = await submitFeedback(
      { token, rating: 5, comment: null },
      fixtureDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.outcome).toBe('positive_routed');
    expect(result.data.redirectUrl).toContain('ChIJ-Demo');
  });

  it('negative (1★) → captures privately, no redirect', async () => {
    const token = generateRequestToken();
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(reviewRequests).values({
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        channel: 'email',
        contactInfo: { email: 'negative-e2e@demo.com', locale: 'es' },
        token,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    );
    const result = await submitFeedback(
      { token, rating: 1, comment: 'Largo tiempo de espera.' },
      fixtureDeps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.outcome).toBe('negative_captured');
    expect(result.data.redirectUrl).toBeNull();
  });

  it('submitting twice on the same token returns NOT_FOUND on the second attempt', async () => {
    const token = generateRequestToken();
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(reviewRequests).values({
        organizationId: orgA,
        brandId: brandA,
        locationId: locationA,
        channel: 'email',
        contactInfo: { email: 'replay-e2e@demo.com', locale: 'es' },
        token,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    );
    const first = await submitFeedback(
      { token, rating: 5, comment: null },
      fixtureDeps(),
    );
    expect(first.ok).toBe(true);

    const second = await submitFeedback(
      { token, rating: 1, comment: 'replay' },
      fixtureDeps(),
    );
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.error.code).toBe('NOT_FOUND');
  });
});

describe('Rate limiter behaviour matching the Server Action contract', () => {
  it('blocks the 6th hit per (IP, action) within 60s', async () => {
    const store = new InMemoryRateLimitStore();
    const limiter = createRateLimiter(store, { limit: 5, windowSeconds: 60 });
    for (let i = 0; i < 5; i++) {
      const v = await limiter.checkRate('203.0.113.7', 'feedback.submit');
      expect(v.allowed).toBe(true);
    }
    const v = await limiter.checkRate('203.0.113.7', 'feedback.submit');
    expect(v.allowed).toBe(false);
    expect(v.retryAfterSeconds).toBe(60);
  });
});
