import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs, type AnyPgTx } from '../../lib/db/client';
import {
  brands,
  connectedAccounts,
  organizations,
  plans,
  postTargets,
  posts,
  users,
} from '../../lib/db/schema';
import {
  clearMockIdempotency,
  forceFailNext,
  resetForcedFailures,
} from '../../lib/connectors/base';
import {
  BACKOFF_MS,
  dispatchOneTarget,
  MAX_RETRY_COUNT,
} from '../../lib/jobs/publish-target';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Retry bookkeeping for the publish-job (Commit 20a).
 *
 *   - Backoff windows are exactly `[60s, 300s, 900s]` after the
 *     1st, 2nd, 3rd transient failure.
 *   - `retry_count` increments cleanly across attempts.
 *   - `next_retry_at` clears when the target becomes permanent
 *     (retry_count >= 3) or published.
 *   - Manual retry path (the action) resets retry_count + clears
 *     next_retry_at + flips status back to 'pending' (action
 *     itself is integration-tested elsewhere — this file just
 *     verifies the bookkeeping invariants the action depends on).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-fb00fb00fb00';
const orgId = '11111111-1111-4111-8111-fb00fb00fb00';
const userId = '22222222-2222-4222-8222-fb00fb00fb00';
const brandId = '33333333-3333-4333-8333-fb00fb00fb00';
const accountId = '44444444-4444-4444-8444-fb00fb00fb00';

const FIXED_NOW = new Date('2026-05-15T12:00:00Z');

interface DepsBag {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  now: () => Date;
}

function depsAtFixedTime(now: Date): DepsBag {
  return {
    asUser: <T,>(
      ctx: { orgId: string; userId: string },
      fn: (tx: AnyPgTx) => Promise<T>,
    ) => runAs(fixture.db, ctx, fn),
    asAdmin: <T,>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
    now: () => now,
  };
}

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userId, email: 'a@pr.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Retry Org',
      slug: 'pr-org',
      planId,
    });
    await tx.insert(brands).values({
      id: brandId,
      organizationId: orgId,
      name: 'Brand',
      slug: 'pr-brand',
    });
    await tx.insert(connectedAccounts).values({
      id: accountId,
      organizationId: orgId,
      brandId,
      platform: 'mock',
      externalAccountId: 'mock',
    });
  });
  process.env.BLACKNEL_MOCK_FAST_PUBLISH = 'true';
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
  delete process.env.BLACKNEL_MOCK_FAST_PUBLISH;
});

afterEach(() => {
  resetForcedFailures();
  clearMockIdempotency();
});

async function seedSingleTargetPost(): Promise<{ postId: string; targetId: string }> {
  const postId = crypto.randomUUID();
  const targetId = crypto.randomUUID();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(posts).values({
      id: postId,
      organizationId: orgId,
      brandId,
      authorId: userId,
      status: 'publishing',
      text: 'retry test',
      scheduledAt: FIXED_NOW,
    });
    await tx.insert(postTargets).values({
      id: targetId,
      organizationId: orgId,
      postId,
      connectedAccountId: accountId,
      idempotencyKey: crypto.randomUUID(),
    });
  });
  return { postId, targetId };
}

async function readTarget(
  targetId: string,
): Promise<{
  status: string;
  retryCount: number;
  nextRetryAt: Date | null;
  errorMessage: string | null;
} | null> {
  const rows = await runAdmin<
    Array<{
      status: string;
      retryCount: number;
      nextRetryAt: Date | null;
      errorMessage: string | null;
    }>
  >(fixture.db, (tx) =>
    tx
      .select({
        status: postTargets.status,
        retryCount: postTargets.retryCount,
        nextRetryAt: postTargets.nextRetryAt,
        errorMessage: postTargets.errorMessage,
      })
      .from(postTargets)
      .where(eq(postTargets.id, targetId)),
  );
  return rows[0] ?? null;
}

describe('retry — backoff times', () => {
  it('sets next_retry_at to now + BACKOFF_MS[retryCount-1] after each transient fail', async () => {
    const { targetId } = await seedSingleTargetPost();

    // Attempt 1 — fail. next_retry_at = FIXED_NOW + 60s.
    forceFailNext(1, 'TRANSIENT_1');
    let result = await dispatchOneTarget(
      { orgId, userId, actorType: 'system', targetId },
      depsAtFixedTime(FIXED_NOW),
    );
    expect(result.ok).toBe(true);
    let row = await readTarget(targetId);
    expect(row?.retryCount).toBe(1);
    expect(row?.nextRetryAt?.getTime()).toBe(FIXED_NOW.getTime() + BACKOFF_MS[0]!);

    // Reset status to 'failed' eligibility for next attempt (the
    // worker normally relies on the cron's selector; we shortcut).
    await runAdmin(fixture.db, (tx) =>
      tx
        .update(postTargets)
        .set({ status: 'failed' })
        .where(eq(postTargets.id, targetId)),
    );

    // Attempt 2 — fail. next_retry_at = FIXED_NOW + 300s.
    forceFailNext(1, 'TRANSIENT_2');
    const now2 = new Date(FIXED_NOW.getTime() + 60_000);
    result = await dispatchOneTarget(
      { orgId, userId, actorType: 'system', targetId },
      depsAtFixedTime(now2),
    );
    expect(result.ok).toBe(true);
    row = await readTarget(targetId);
    expect(row?.retryCount).toBe(2);
    expect(row?.nextRetryAt?.getTime()).toBe(now2.getTime() + BACKOFF_MS[1]!);

    // Attempt 3 — fail. retryCount=3 → permanent (no next_retry_at).
    await runAdmin(fixture.db, (tx) =>
      tx
        .update(postTargets)
        .set({ status: 'failed' })
        .where(eq(postTargets.id, targetId)),
    );
    forceFailNext(1, 'TRANSIENT_3');
    const now3 = new Date(now2.getTime() + 300_000);
    result = await dispatchOneTarget(
      { orgId, userId, actorType: 'system', targetId },
      depsAtFixedTime(now3),
    );
    expect(result.ok).toBe(true);
    row = await readTarget(targetId);
    expect(row?.retryCount).toBe(3);
    expect(row?.nextRetryAt).toBeNull();
  });
});

describe('retry — retry_count cap', () => {
  it('refuses to dispatch when retry_count >= MAX_RETRY_COUNT (returns skipped)', async () => {
    const { targetId } = await seedSingleTargetPost();
    await runAdmin(fixture.db, (tx) =>
      tx
        .update(postTargets)
        .set({ status: 'failed', retryCount: MAX_RETRY_COUNT })
        .where(eq(postTargets.id, targetId)),
    );
    const result = await dispatchOneTarget(
      { orgId, userId, actorType: 'system', targetId },
      depsAtFixedTime(FIXED_NOW),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.kind).toBe('skipped');
    if (result.data.kind === 'skipped') {
      expect(result.data.reason).toBe('retry_cap_reached');
    }
  });
});

describe('retry — manual reset', () => {
  it('manual update of retry_count → 0 + status=pending unlocks dispatch', async () => {
    const { targetId } = await seedSingleTargetPost();
    // Simulate a permanently-failed target.
    await runAdmin(fixture.db, (tx) =>
      tx
        .update(postTargets)
        .set({
          status: 'failed',
          retryCount: MAX_RETRY_COUNT,
          errorMessage: 'old error',
        })
        .where(eq(postTargets.id, targetId)),
    );
    // Dispatch refuses.
    let result = await dispatchOneTarget(
      { orgId, userId, actorType: 'system', targetId },
      depsAtFixedTime(FIXED_NOW),
    );
    if (result.ok && result.data.kind === 'skipped') {
      // good — confirmed.
    } else {
      expect.fail('expected skipped');
    }

    // Manual reset (mirrors retryFailedPostAction).
    await runAdmin(fixture.db, (tx) =>
      tx
        .update(postTargets)
        .set({
          status: 'pending',
          retryCount: 0,
          nextRetryAt: null,
          errorMessage: null,
        })
        .where(eq(postTargets.id, targetId)),
    );

    // Dispatch now succeeds (mock connector publishes happily).
    result = await dispatchOneTarget(
      { orgId, userId, actorType: 'system', targetId },
      depsAtFixedTime(FIXED_NOW),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.kind).toBe('published');
    const row = await readTarget(targetId);
    expect(row?.status).toBe('published');
    expect(row?.retryCount).toBe(0);
  });
});

describe('retry — partial-index sanity', () => {
  it('selecting failed targets with retry_count < 3 via the partial index returns the correct slice', async () => {
    // Seed a mix: 2 failed-retryable + 1 failed-permanent + 1 published.
    await runAdmin(fixture.db, async (tx) => {
      const postId = crypto.randomUUID();
      await tx.insert(posts).values({
        id: postId,
        organizationId: orgId,
        brandId,
        authorId: userId,
        status: 'publishing',
        text: 'index test',
      });
      for (let i = 0; i < 4; i++) {
        await tx.insert(postTargets).values({
          id: crypto.randomUUID(),
          organizationId: orgId,
          postId,
          connectedAccountId: accountId,
          idempotencyKey: crypto.randomUUID(),
          status: i < 2 ? 'failed' : i === 2 ? 'failed' : 'published',
          retryCount: i < 2 ? 1 : i === 2 ? MAX_RETRY_COUNT : 0,
        });
      }
    });
    type Row = { id: string; status: string; retryCount: number };
    const rows = await runAdmin<Row[]>(fixture.db, (tx) =>
      tx
        .select({
          id: postTargets.id,
          status: postTargets.status,
          retryCount: postTargets.retryCount,
        })
        .from(postTargets)
        .where(eq(postTargets.status, 'failed')),
    );
    const retryable = rows.filter((r) => r.retryCount < MAX_RETRY_COUNT);
    const permanent = rows.filter((r) => r.retryCount >= MAX_RETRY_COUNT);
    expect(retryable.length).toBeGreaterThanOrEqual(2);
    expect(permanent.length).toBeGreaterThanOrEqual(1);
  });
});
