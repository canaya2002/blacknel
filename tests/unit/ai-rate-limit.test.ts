import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import {
  BUCKET_CONFIG,
  assertWithinRateLimit,
  consumeRateToken,
  refillAndConsume,
  _resetNowForTests,
  _resetRunAdminForTests,
  _setNowForTests,
  _setRunAdminForTests,
} from '../../lib/ai/rate-limit';
import { aiRateBuckets, organizations, plans } from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

describe('refillAndConsume (pure)', () => {
  const cfg = { capacity: 5, refillPerSec: 1 };

  it('consumes one token from a full bucket', () => {
    const r = refillAndConsume({ tokens: 5, updatedAtMs: 0 }, cfg, 0);
    expect(r.allowed).toBe(true);
    expect(r.next.tokens).toBe(4);
  });

  it('rejects an empty bucket with no elapsed time', () => {
    const r = refillAndConsume({ tokens: 0, updatedAtMs: 0 }, cfg, 0);
    expect(r.allowed).toBe(false);
    expect(r.next.tokens).toBe(0);
  });

  it('refills by elapsed time then consumes', () => {
    // 0 tokens + 2s @1/s = 2 refilled → consume → ~1 left.
    const r = refillAndConsume({ tokens: 0, updatedAtMs: 0 }, cfg, 2000);
    expect(r.allowed).toBe(true);
    expect(r.next.tokens).toBeCloseTo(1);
  });

  it('clamps refill at capacity', () => {
    const r = refillAndConsume({ tokens: 0, updatedAtMs: 0 }, cfg, 1_000_000);
    expect(r.allowed).toBe(true);
    expect(r.next.tokens).toBe(4); // min(capacity, ...) - 1
  });

  it('rejects when the refill is still < 1 token', () => {
    // 0 tokens + 0.5s @1/s = 0.5 < 1 → reject.
    const r = refillAndConsume({ tokens: 0, updatedAtMs: 0 }, cfg, 500);
    expect(r.allowed).toBe(false);
  });
});

describe('consumeRateToken (persisted, standard plan)', () => {
  let fixture: TestDb;
  const planId = '00000000-0000-4000-8000-bbbbbbbbbbbb';
  const orgId = '22222222-2222-4222-8222-bbbbbbbbbbbb';
  let fakeNow = 1_000_000_000_000;

  beforeAll(async () => {
    fixture = await createTestDb();
    await runAdmin(fixture.db, async (tx) => {
      await tx
        .insert(plans)
        .values({ id: planId, code: 'standard', name: 'Standard', priceCents: 6900 });
      await tx
        .insert(organizations)
        .values({ id: orgId, name: 'RL Org', slug: 'rl-org', planId });
    });
    _setRunAdminForTests((fn) => runAdmin(fixture.db, fn));
    _setNowForTests(() => fakeNow);
  }, 60_000);

  afterAll(async () => {
    _resetRunAdminForTests();
    _resetNowForTests();
    await fixture.dispose();
  });

  it('allows up to capacity, then rate-limits, and PERSISTS the depletion', async () => {
    const cap = BUCKET_CONFIG.standard.capacity; // 5
    for (let i = 0; i < cap; i++) {
      expect(await consumeRateToken(orgId, 'standard')).toBe(true);
    }
    expect(await consumeRateToken(orgId, 'standard')).toBe(false);

    // Survives "cold start": the depleted bucket is a persisted DB row, not
    // in-memory — a fresh read sees < 1 token.
    const rows = await runAdmin<Array<{ tokens: number }>>(fixture.db, (tx) =>
      tx
        .select({ tokens: aiRateBuckets.tokens })
        .from(aiRateBuckets)
        .where(eq(aiRateBuckets.organizationId, orgId)),
    );
    expect(rows[0]!.tokens).toBeLessThan(1);
  });

  it('refills after enough time elapses', async () => {
    fakeNow += 60_000; // 60s → standard refill (5/60)/s × 60 = 5 → full.
    expect(await consumeRateToken(orgId, 'standard')).toBe(true);
  });

  it('assertWithinRateLimit throws rate_limited on an empty bucket', async () => {
    // Drain whatever is left at the current (non-advancing) clock.
    for (let i = 0; i < BUCKET_CONFIG.standard.capacity; i++) {
      await consumeRateToken(orgId, 'standard');
    }
    await expect(assertWithinRateLimit(orgId, 'standard')).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });
});
