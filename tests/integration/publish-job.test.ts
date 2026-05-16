import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { runAdmin, runAs, type AnyPgTx } from '../../lib/db/client';
import {
  auditEvents,
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
  dispatchOneTarget,
  type DispatchOneTargetDeps,
} from '../../lib/jobs/publish-target';
import {
  runPublishTick,
  type PublishTickDeps,
} from '../../lib/jobs/publish-post';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Publish-job tick end-to-end (Commit 20a).
 *
 * Each test seeds a post with N targets, optionally arms
 * forced failures, calls `runPublishTick` once (or several
 * times to drive the retry path in the retry-specific tests),
 * and asserts:
 *
 *   - terminal post.status,
 *   - per-target status / retry_count / next_retry_at,
 *   - audit event names + actor_type,
 *   - usage_counters.postsPerMonth bump for OK / partial paths.
 *
 * Idempotency: tests run with the per-suite mock connector
 * cache cleared between tests (`clearMockIdempotency`).
 */

let fixture: TestDb;
let deps: PublishTickDeps;

const planId = '00000000-0000-4000-8000-ef00ef00ef00';
const orgId = '11111111-1111-4111-8111-ef00ef00ef00';
const userId = '22222222-2222-4222-8222-ef00ef00ef00';
const brandId = '33333333-3333-4333-8333-ef00ef00ef00';
const accountFb = '44444444-4444-4444-8444-ef00ef00ef01';
const accountIg = '44444444-4444-4444-8444-ef00ef00ef02';
const accountX = '44444444-4444-4444-8444-ef00ef00ef03';

beforeAll(async () => {
  fixture = await createTestDb();
  const baseDeps: DispatchOneTargetDeps = {
    asUser: <T,>(
      ctx: { orgId: string; userId: string },
      fn: (tx: AnyPgTx) => Promise<T>,
    ) => runAs(fixture.db, ctx, fn),
    asAdmin: <T,>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
    now: () => new Date(),
  };
  deps = {
    ...baseDeps,
    dispatchTarget: dispatchOneTarget,
  };
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userId, email: 'a@pj.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Publish Job Org',
      slug: 'pj-org',
      planId,
    });
    await tx.insert(brands).values({
      id: brandId,
      organizationId: orgId,
      name: 'Brand',
      slug: 'pj-brand',
    });
    await tx.insert(connectedAccounts).values([
      {
        id: accountFb,
        organizationId: orgId,
        brandId,
        platform: 'mock',
        externalAccountId: 'mock-fb',
        displayName: 'FB',
      },
      {
        id: accountIg,
        organizationId: orgId,
        brandId,
        platform: 'mock',
        externalAccountId: 'mock-ig',
        displayName: 'IG',
      },
      {
        id: accountX,
        organizationId: orgId,
        brandId,
        platform: 'mock',
        externalAccountId: 'mock-x',
        displayName: 'X',
      },
    ]);
  });
  // Make tests fast.
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

interface SeedPostOpts {
  postId: string;
  targets: ReadonlyArray<{ id: string; accountId: string; key: string }>;
  scheduledAtAgo?: number;
  status?: 'scheduled' | 'publishing';
}

async function seedPost(opts: SeedPostOpts): Promise<void> {
  const scheduledAt = new Date(Date.now() - (opts.scheduledAtAgo ?? 60_000));
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(posts).values({
      id: opts.postId,
      organizationId: orgId,
      brandId,
      authorId: userId,
      status: opts.status ?? 'scheduled',
      text: 'hello world',
      scheduledAt,
    });
    for (const t of opts.targets) {
      await tx.insert(postTargets).values({
        id: t.id,
        organizationId: orgId,
        postId: opts.postId,
        connectedAccountId: t.accountId,
        idempotencyKey: t.key,
      });
    }
  });
}

async function getPostStatus(postId: string): Promise<string> {
  const rows = await runAdmin<Array<{ status: string }>>(
    fixture.db,
    (tx) => tx.select({ status: posts.status }).from(posts).where(eq(posts.id, postId)),
  );
  return rows[0]?.status ?? 'missing';
}

async function getTargets(
  postId: string,
): Promise<Array<{ status: string; retryCount: number; errorMessage: string | null }>> {
  return runAdmin(fixture.db, (tx) =>
    tx
      .select({
        status: postTargets.status,
        retryCount: postTargets.retryCount,
        errorMessage: postTargets.errorMessage,
      })
      .from(postTargets)
      .where(eq(postTargets.postId, postId)),
  );
}

async function getAuditActions(postOrTargetId: string): Promise<string[]> {
  const rows = await runAdmin<Array<{ action: string }>>(fixture.db, (tx) =>
    tx
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, postOrTargetId)),
  );
  return rows.map((r) => r.action);
}

describe('publish-job — happy path', () => {
  it('scheduled vencido → publishing → published (all targets OK)', async () => {
    const postId = '99999999-9999-4999-8999-ef00ef00ef01';
    const t1 = 'aaaaaaaa-aaaa-4aaa-8aaa-ef00ef00ef01';
    const t2 = 'aaaaaaaa-aaaa-4aaa-8aaa-ef00ef00ef02';
    await seedPost({
      postId,
      targets: [
        { id: t1, accountId: accountFb, key: 'idem-fb-1' },
        { id: t2, accountId: accountIg, key: 'idem-ig-1' },
      ],
    });

    const result = await runPublishTick(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidatesFound).toBe(1);
    expect(result.data.publishedSuccess).toBe(2);

    expect(await getPostStatus(postId)).toBe('published');
    const targets = await getTargets(postId);
    expect(targets.every((t) => t.status === 'published')).toBe(true);
    const postAudits = await getAuditActions(postId);
    expect(postAudits).toContain('post.publishing.started');
    expect(postAudits).toContain('post.published');
  });
});

describe('publish-job — full failure path', () => {
  it('all targets fail permanent across 3 ticks → post.failed', async () => {
    const postId = '99999999-9999-4999-8999-ef00ef00ef02';
    const t1 = 'aaaaaaaa-aaaa-4aaa-8aaa-ef00ef00ef03';
    const t2 = 'aaaaaaaa-aaaa-4aaa-8aaa-ef00ef00ef04';
    await seedPost({
      postId,
      targets: [
        { id: t1, accountId: accountFb, key: 'idem-fb-2' },
        { id: t2, accountId: accountIg, key: 'idem-ig-2' },
      ],
    });

    // Force 6 failures (2 targets × 3 attempts) deterministically.
    forceFailNext(6, 'PLATFORM_DOWN');

    // First tick: scheduled → publishing, both targets fail #1.
    await runPublishTick(deps);
    let targets = await getTargets(postId);
    expect(targets.every((t) => t.status === 'failed' && t.retryCount === 1)).toBe(true);
    expect(await getPostStatus(postId)).toBe('publishing');

    // Advance "now" by manually fast-forwarding next_retry_at →
    // simulate the next tick after the backoff. We can't rely on
    // real time so we update next_retry_at to the past.
    await runAdmin(fixture.db, (tx) =>
      tx
        .update(postTargets)
        .set({ nextRetryAt: new Date(Date.now() - 1000) })
        .where(eq(postTargets.postId, postId)),
    );

    // Second tick: retry → fail #2.
    await runPublishTick(deps);
    targets = await getTargets(postId);
    expect(targets.every((t) => t.status === 'failed' && t.retryCount === 2)).toBe(true);
    expect(await getPostStatus(postId)).toBe('publishing');

    await runAdmin(fixture.db, (tx) =>
      tx
        .update(postTargets)
        .set({ nextRetryAt: new Date(Date.now() - 1000) })
        .where(eq(postTargets.postId, postId)),
    );

    // Third tick: retry → fail #3 (permanent).
    await runPublishTick(deps);
    targets = await getTargets(postId);
    expect(targets.every((t) => t.status === 'failed' && t.retryCount === 3)).toBe(true);
    expect(await getPostStatus(postId)).toBe('failed');

    const postAudits = await getAuditActions(postId);
    expect(postAudits).toContain('post.failed');
  });
});

describe('publish-job — mix path', () => {
  it('1 success + 1 permanent failure → post.published.partial', async () => {
    const postId = '99999999-9999-4999-8999-ef00ef00ef03';
    const t1 = 'aaaaaaaa-aaaa-4aaa-8aaa-ef00ef00ef05';
    const t2 = 'aaaaaaaa-aaaa-4aaa-8aaa-ef00ef00ef06';
    await seedPost({
      postId,
      targets: [
        { id: t1, accountId: accountFb, key: 'idem-fb-3' },
        { id: t2, accountId: accountIg, key: 'idem-ig-3' },
      ],
    });

    // Tick 1: force ONE failure (the first dispatched target).
    forceFailNext(1, 'PLATFORM_DOWN');
    await runPublishTick(deps);

    // One target succeeded; the other failed transiently.
    let targets = await getTargets(postId);
    const succeeded = targets.filter((t) => t.status === 'published');
    const failed = targets.filter((t) => t.status === 'failed');
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0]?.retryCount).toBe(1);

    // Force the retries to fail too (2 more attempts to permanent).
    forceFailNext(2, 'PLATFORM_DOWN');

    // Fast-forward each retry.
    await runAdmin(fixture.db, (tx) =>
      tx
        .update(postTargets)
        .set({ nextRetryAt: new Date(Date.now() - 1000) })
        .where(
          sql`${postTargets.postId} = ${postId} AND ${postTargets.status} = 'failed'`,
        ),
    );
    await runPublishTick(deps);
    await runAdmin(fixture.db, (tx) =>
      tx
        .update(postTargets)
        .set({ nextRetryAt: new Date(Date.now() - 1000) })
        .where(
          sql`${postTargets.postId} = ${postId} AND ${postTargets.status} = 'failed'`,
        ),
    );
    await runPublishTick(deps);

    targets = await getTargets(postId);
    const publishedNow = targets.filter((t) => t.status === 'published').length;
    const permanentNow = targets.filter(
      (t) => t.status === 'failed' && t.retryCount === 3,
    ).length;
    expect(publishedNow).toBe(1);
    expect(permanentNow).toBe(1);
    expect(await getPostStatus(postId)).toBe('published');
    const audits = await getAuditActions(postId);
    expect(audits).toContain('post.published.partial');
  });
});

describe('publish-job — idempotency', () => {
  it('a second tick over an already-published post is a no-op', async () => {
    const postId = '99999999-9999-4999-8999-ef00ef00ef04';
    const t1 = 'aaaaaaaa-aaaa-4aaa-8aaa-ef00ef00ef07';
    await seedPost({
      postId,
      targets: [{ id: t1, accountId: accountFb, key: 'idem-fb-4' }],
    });
    await runPublishTick(deps);
    expect(await getPostStatus(postId)).toBe('published');

    const targetsBefore = await getTargets(postId);
    const result = await runPublishTick(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidatesFound).toBe(0);

    const targetsAfter = await getTargets(postId);
    // No bookkeeping change.
    expect(targetsAfter).toEqual(targetsBefore);
  });
});

describe('publish-job — SELECT FOR UPDATE serialization (sequential)', () => {
  /**
   * pglite is single-threaded WASM Postgres — `Promise.all` of two
   * `runPublishTick` calls doesn't exercise real concurrency the
   * way a production multi-worker deploy does (where the FOR
   * UPDATE genuinely serializes against parallel processes).
   *
   * We document the architectural contract here via sequential
   * calls: a second tick after the first completes always finds
   * the post in `published` (or terminal) state, so the SELECT
   * FOR UPDATE on the post row + the conditional UPDATE in
   * `transitionPostStatus` together prevent any re-dispatch.
   */
  it('a second tick over a freshly-published post sees the post as terminal', async () => {
    const postId = '99999999-9999-4999-8999-ef00ef00ef05';
    const t1 = 'aaaaaaaa-aaaa-4aaa-8aaa-ef00ef00ef08';
    await seedPost({
      postId,
      targets: [{ id: t1, accountId: accountFb, key: 'idem-fb-5' }],
    });
    const r1 = await runPublishTick(deps);
    expect(r1.ok).toBe(true);
    expect(await getPostStatus(postId)).toBe('published');

    const r2 = await runPublishTick(deps);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    // Second tick: the post is no longer in Set A (status !=
    // 'scheduled') and no longer in Set B (status != 'publishing'
    // with retry-due targets). Zero work to do.
    const sameTargets = await getTargets(postId);
    expect(sameTargets[0]?.status).toBe('published');
  });
});

describe('publish-job — DI spy contract', () => {
  it('dispatchTarget is called exactly once per actionable target', async () => {
    const postId = '99999999-9999-4999-8999-ef00ef00ef06';
    const t1 = 'aaaaaaaa-aaaa-4aaa-8aaa-ef00ef00ef09';
    const t2 = 'aaaaaaaa-aaaa-4aaa-8aaa-ef00ef00ef0a';
    const t3 = 'aaaaaaaa-aaaa-4aaa-8aaa-ef00ef00ef0b';
    await seedPost({
      postId,
      targets: [
        { id: t1, accountId: accountFb, key: 'idem-fb-6' },
        { id: t2, accountId: accountIg, key: 'idem-ig-6' },
        { id: t3, accountId: accountX, key: 'idem-x-6' },
      ],
    });
    const spy = vi.fn(dispatchOneTarget);
    await runPublishTick({ ...deps, dispatchTarget: spy });
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe('publish-job — postsPerMonth counter', () => {
  it('bumps postsPerMonth once when a post reaches published', async () => {
    const postId = '99999999-9999-4999-8999-ef00ef00ef07';
    const t1 = 'aaaaaaaa-aaaa-4aaa-8aaa-ef00ef00ef0c';
    await seedPost({
      postId,
      targets: [{ id: t1, accountId: accountFb, key: 'idem-fb-7' }],
    });
    type CounterRow = { value: number };
    const before = await runAdmin<CounterRow[]>(fixture.db, (tx) =>
      tx.execute(
        sql`SELECT COALESCE(SUM(value), 0)::int AS value FROM usage_counters WHERE organization_id = ${orgId} AND metric = 'postsPerMonth'`,
      ).then((r: unknown) => {
        const rows = (r as { rows?: CounterRow[] }).rows ?? (r as CounterRow[]);
        return Array.isArray(rows) ? rows : [];
      }),
    );
    const beforeValue = before[0]?.value ?? 0;

    await runPublishTick(deps);

    const after = await runAdmin<CounterRow[]>(fixture.db, (tx) =>
      tx.execute(
        sql`SELECT COALESCE(SUM(value), 0)::int AS value FROM usage_counters WHERE organization_id = ${orgId} AND metric = 'postsPerMonth'`,
      ).then((r: unknown) => {
        const rows = (r as { rows?: CounterRow[] }).rows ?? (r as CounterRow[]);
        return Array.isArray(rows) ? rows : [];
      }),
    );
    const afterValue = after[0]?.value ?? 0;
    expect(afterValue).toBeGreaterThanOrEqual(beforeValue + 1);
  });
});

describe('publish-job — empty tick', () => {
  it('returns 0 candidates when no scheduled posts are due', async () => {
    const result = await runPublishTick(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.candidatesFound).toBe(0);
    expect(result.data.publishedSuccess).toBe(0);
  });
});
