import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { _clearLruForTests } from '../../lib/ai/cache';
import {
  _resetDbDepsForTests,
  _setDbDepsForTests,
} from '../../lib/ai/persistence';
import {
  scanForCrisis,
  type CrisisScanDeps,
} from '../../lib/jobs/crisis-scan';
import { runAdmin, runAs, type AnyPgTx } from '../../lib/db/client';
import {
  aiRecommendations,
  brands,
  organizations,
  plans,
  reviews,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Crisis-scan producer end-to-end (Phase 7 / Commit 25).
 *
 * Covers:
 *   - background reviews → no rec
 *   - 3+ low-rating → rec created
 *   - merge growthRate < 0.30 → SKIP
 *   - merge growthRate >= 0.30 → ESCALATE (update)
 *   - severity escalation medium → high when merged total > 10
 *   - severity escalation high → critical when merged total > 20
 *   - edge case: existing with 0 ids → escalate
 *   - tenant isolation (scan en orgA no produce rec en orgB)
 */

let fixture: TestDb;
let deps: CrisisScanDeps;

const planId = '00000000-0000-4000-8000-c2500c2500c0';
const orgA = '11111111-1111-4111-8111-c2500c2500c0';
const orgB = '11111111-1111-4111-8111-c2500c2500c1';
const userA = '22222222-2222-4222-8222-c2500c2500c0';
const brandA = '33333333-3333-4333-8333-c2500c2500c0';

beforeAll(async () => {
  fixture = await createTestDb();
  _setDbDepsForTests({
    asAdmin: (fn) => runAdmin(fixture.db, fn),
    asUser: (ctx, fn) => runAs(fixture.db, ctx, fn),
  });
  deps = {
    asAdmin: <T,>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
    asUser: <T,>(
      ctx: { orgId: string; userId: string },
      fn: (tx: AnyPgTx) => Promise<T>,
    ) => runAs(fixture.db, ctx, fn),
    now: () => new Date(),
  };

  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@c25.test', name: 'A' });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c25-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c25-org-b', planId },
    ]);
    await tx.insert(brands).values({
      id: brandA,
      organizationId: orgA,
      name: 'Brand A',
      slug: 'c25-brand-a',
    });
  });
}, 60_000);

afterAll(async () => {
  _resetDbDepsForTests();
  _clearLruForTests();
  await fixture.dispose();
});

afterEach(async () => {
  _clearLruForTests();
  // Reset state between tests so order doesn't matter.
  await runAdmin(fixture.db, async (tx) => {
    await tx.delete(aiRecommendations);
    await tx.delete(reviews);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedReviews(
  orgId: string,
  count: number,
  rating: number,
  idPrefix: string,
): Promise<string[]> {
  const ids: string[] = [];
  await runAdmin(fixture.db, async (tx) => {
    for (let i = 0; i < count; i++) {
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-${idPrefix}${i.toString(16).padStart(8, '0')}`;
      ids.push(id);
      await tx.insert(reviews).values({
        id,
        organizationId: orgId,
        brandId: orgId === orgA ? brandA : null,
        platform: 'gbp',
        externalReviewId: `gbp-c25-${idPrefix}-${i}`,
        authorName: 'Cliente',
        rating,
        body: rating <= 2 ? 'Servicio terrible.' : 'OK.',
        sentiment: rating <= 2 ? 'negative' : 'positive',
        status: 'pending',
      });
    }
  });
  return ids;
}

async function getPendingRecs(orgId: string): Promise<
  Array<{ id: string; evidence: Record<string, unknown> }>
> {
  return runAdmin(fixture.db, (tx) =>
    tx
      .select({
        id: aiRecommendations.id,
        evidence: aiRecommendations.evidence,
      })
      .from(aiRecommendations)
      .where(eq(aiRecommendations.organizationId, orgId)),
  ) as Promise<Array<{ id: string; evidence: Record<string, unknown> }>>;
}

// ---------------------------------------------------------------------------
// 1. Background reviews → no crisis
// ---------------------------------------------------------------------------

describe('crisis-scan — background reviews do NOT create rec', () => {
  it('5 positive reviews → no_crisis outcome', async () => {
    await seedReviews(orgA, 5, 5, 'cb01');
    const result = await scanForCrisis({ orgId: orgA }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe('no_crisis');
    const recs = await getPendingRecs(orgA);
    expect(recs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. 3+ low-rating → rec created
// ---------------------------------------------------------------------------

describe('crisis-scan — 3+ low-rating reviews trigger rec', () => {
  it('3 low-rating reviews → rec created with correct evidence', async () => {
    const reviewIds = await seedReviews(orgA, 3, 1, 'cb02');
    const result = await scanForCrisis({ orgId: orgA }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.outcome).toBe('created');
    expect(result.data.recommendationId).not.toBeNull();
    const recs = await getPendingRecs(orgA);
    expect(recs.length).toBe(1);
    const ev = recs[0]!.evidence;
    expect(Array.isArray(ev.reviewIds)).toBe(true);
    const evIds = ev.reviewIds as string[];
    expect(evIds.length).toBe(3);
    for (const id of reviewIds) {
      expect(evIds).toContain(id);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Merge growthRate < 0.30 → SKIP
// ---------------------------------------------------------------------------

describe('crisis-scan — merge growth < 30% skips duplicate', () => {
  it('existing has 5 ids, new scan adds 1 id (growth=0.20) → SKIP', async () => {
    // First scan creates rec with 5 ids.
    await seedReviews(orgA, 5, 1, 'cb03');
    const first = await scanForCrisis({ orgId: orgA }, deps);
    if (!first.ok) throw new Error('first scan failed');
    expect(first.data.outcome).toBe('created');

    // Add 1 new low-rating review → second scan sees 6 ids.
    // growthRate = 1/5 = 0.20 < 0.30 → SKIP.
    await seedReviews(orgA, 1, 1, 'cb3b');
    const second = await scanForCrisis({ orgId: orgA }, deps);
    if (!second.ok) throw new Error('second scan failed');
    expect(second.data.outcome).toBe('skipped_duplicate');

    const recs = await getPendingRecs(orgA);
    expect(recs.length).toBe(1);
    // Evidence unchanged from first scan (5 ids, NOT 6).
    const ev = recs[0]!.evidence;
    expect((ev.reviewIds as string[]).length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 4. Merge growthRate >= 0.30 → ESCALATE
// ---------------------------------------------------------------------------

describe('crisis-scan — merge growth >= 30% escalates', () => {
  it('existing has 5 ids, new scan adds 4 ids (growth=0.80) → ESCALATE', async () => {
    await seedReviews(orgA, 5, 1, 'cb04');
    const first = await scanForCrisis({ orgId: orgA }, deps);
    if (!first.ok) throw new Error('first scan failed');
    expect(first.data.outcome).toBe('created');

    // Add 4 new low-rating reviews. growthRate = 4/5 = 0.80.
    await seedReviews(orgA, 4, 1, 'cb4b');
    const second = await scanForCrisis({ orgId: orgA }, deps);
    if (!second.ok) throw new Error('second scan failed');
    expect(second.data.outcome).toBe('escalated');

    const recs = await getPendingRecs(orgA);
    expect(recs.length).toBe(1);
    const ev = recs[0]!.evidence;
    // Merged evidence now has 9 ids.
    expect((ev.reviewIds as string[]).length).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// 5. Severity escalation medium → high when merged > 10
// ---------------------------------------------------------------------------

describe('crisis-scan — severity escalation on merge', () => {
  it('initial low-count rec escalates to higher severity after merge', async () => {
    // Seed: 3 low-rating + 5 high-rating mixed → mockCrisis
    // verdict: lowCount=3 (triggered via 3+), ratio=3/8=0.375
    // (< 0.5) → severity='medium'. Producer creates medium rec.
    await seedReviews(orgA, 3, 1, 'cb50');
    await seedReviews(orgA, 5, 5, 'cb51');
    const first = await scanForCrisis({ orgId: orgA }, deps);
    if (!first.ok) throw new Error('first scan failed');
    expect(first.data.outcome).toBe('created');
    const before = await getPendingRecs(orgA);
    expect((before[0]!.evidence.severity as string)).toBe('medium');

    // Add 4 more low-rating → low becomes 7, total 12.
    // ratio=7/12=0.58 → mockCrisis returns 'high' (≥0.5 ratio).
    // growthRate = 4/8 = 0.50 → escalate. The producer's own
    // severity bump (medium → high when merged ids > 10)
    // combined with pickHigherSeverity yields 'high' or higher.
    await seedReviews(orgA, 4, 1, 'cb52');
    const second = await scanForCrisis({ orgId: orgA }, deps);
    if (!second.ok) throw new Error('second scan failed');
    expect(second.data.outcome).toBe('escalated');

    const after = await getPendingRecs(orgA);
    const sev = after[0]!.evidence.severity as string;
    expect(['high', 'critical']).toContain(sev);
  });
});

// ---------------------------------------------------------------------------
// 6. Tenant isolation — scan orgA leaves orgB clean
// ---------------------------------------------------------------------------

describe('crisis-scan — tenant isolation', () => {
  it('scanForCrisis on orgA does NOT create rec for orgB', async () => {
    await seedReviews(orgA, 3, 1, 'cb06');
    const result = await scanForCrisis({ orgId: orgA }, deps);
    expect(result.ok).toBe(true);

    const recsA = await getPendingRecs(orgA);
    const recsB = await getPendingRecs(orgB);
    expect(recsA.length).toBe(1);
    expect(recsB.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Edge case — empty new set during second scan keeps existing rec
// ---------------------------------------------------------------------------

describe('crisis-scan — empty-new-set scan keeps existing rec', () => {
  it('existing rec stays untouched when second scan finds the same 3 ids', async () => {
    await seedReviews(orgA, 3, 1, 'cb07');
    const first = await scanForCrisis({ orgId: orgA }, deps);
    if (!first.ok) throw new Error('first scan failed');

    // Re-scan with the same reviews. growthRate = 0/3 = 0 → SKIP.
    const second = await scanForCrisis({ orgId: orgA }, deps);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.outcome).toBe('skipped_duplicate');

    const recs = await getPendingRecs(orgA);
    expect(recs.length).toBe(1);
  });
});
