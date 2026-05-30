import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { NormalizedPostInsights } from '../../lib/connectors/base/normalized';
import type { ConnectorAccount } from '../../lib/connectors/base/types';
import { runPostInsightsSync } from '../../lib/connectors/post-insights-sync';
import { type AnyPgTx, runAdmin, runAsOrg } from '../../lib/db/client';
import {
  connectedAccounts,
  organizations,
  plans,
  postInsights,
  postTargets,
  posts,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C52 post-insights sync. pglite + RLS, injected mock fetch (no network).
 * Covers: only published targets with an external id are synced, upsert is
 * idempotent, and one org never sees another's insights.
 */

let fixture: TestDb;
const NOW = new Date('2026-05-30T12:00:00Z');
const RECENT = new Date('2026-05-20T00:00:00Z');

const planId = '00000000-0000-4000-8000-c52000000001';
const orgA = '11111111-1111-4111-8111-c52a00000001';
const orgB = '11111111-1111-4111-8111-c52b00000001';
const userA = '22222222-2222-4222-8222-c52a00000001';
const accFbA = '33333333-3333-4333-8333-c52a00000001';
const accFbA2 = '33333333-3333-4333-8333-c52a00000002';
const accFbB = '33333333-3333-4333-8333-c52b00000001';
const postA = '44444444-4444-4444-8444-c52a00000001';
const postB = '44444444-4444-4444-8444-c52b00000001';
const t1 = '55555555-5555-4555-8555-c52a00000001'; // eligible (orgA)
const tNoExt = '55555555-5555-4555-8555-c52a00000002'; // no external id → skip
const tFailed = '55555555-5555-4555-8555-c52a00000003'; // failed → skip
const t2 = '55555555-5555-4555-8555-c52b00000001'; // eligible (orgB)

// Mock fetch — deterministic, ignores tokens entirely.
const fetchInsights = async (
  account: ConnectorAccount,
  externalPostId: string,
): Promise<NormalizedPostInsights> => ({
  platform: account.platform,
  externalPostId,
  reach: 100,
  impressions: 200,
  likes: 10,
  comments: 5,
  shares: 2,
  engagement: 17,
});

const deps = {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => runAsOrg(fixture.db, orgId, fn),
  fetchInsights,
  now: () => NOW,
};

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'enterprise', name: 'Enterprise', priceCents: 109900 });
    await tx.insert(users).values({ id: userA, email: 'a@c52.test', name: 'A' });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c52-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c52-org-b', planId },
    ]);
    await tx.insert(connectedAccounts).values([
      { id: accFbA, organizationId: orgA, platform: 'facebook', externalAccountId: 'pgA', status: 'connected' },
      { id: accFbA2, organizationId: orgA, platform: 'facebook', externalAccountId: 'pgA2', status: 'connected' },
      { id: accFbB, organizationId: orgB, platform: 'facebook', externalAccountId: 'pgB', status: 'connected' },
    ]);
    await tx.insert(posts).values([
      { id: postA, organizationId: orgA, authorId: userA, status: 'published', text: 'A' },
      { id: postB, organizationId: orgB, authorId: userA, status: 'published', text: 'B' },
    ]);
    await tx.insert(postTargets).values([
      { id: t1, organizationId: orgA, postId: postA, connectedAccountId: accFbA, status: 'published', externalPostId: 'fbA-1', publishedAt: RECENT },
      { id: tNoExt, organizationId: orgA, postId: postA, connectedAccountId: accFbA2, status: 'published', externalPostId: null, publishedAt: RECENT },
      { id: tFailed, organizationId: orgA, postId: postA, connectedAccountId: accFbA, status: 'failed', externalPostId: 'fbA-x', publishedAt: RECENT },
      { id: t2, organizationId: orgB, postId: postB, connectedAccountId: accFbB, status: 'published', externalPostId: 'fbB-1', publishedAt: RECENT },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('runPostInsightsSync', () => {
  it('syncs only published targets with an external id', async () => {
    const report = await runPostInsightsSync(deps);
    expect(report.targets).toBe(2); // t1 + t2 only
    expect(report.synced).toBe(2);
    expect(report.failed).toBe(0);

    const all = await runAdmin<Array<{ targetId: string; reach: number }>>(fixture.db, (tx) =>
      tx.select({ targetId: postInsights.postTargetId, reach: postInsights.reach }).from(postInsights),
    );
    expect(all).toHaveLength(2);
    expect(new Set(all.map((r) => r.targetId))).toEqual(new Set([t1, t2]));
    expect(all[0]?.reach).toBe(100);
  });

  it('is idempotent — re-run upserts in place, no duplicates', async () => {
    const before = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx.select({ id: postInsights.id }).from(postInsights),
    );
    await runPostInsightsSync(deps);
    const after = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx.select({ id: postInsights.id }).from(postInsights),
    );
    expect(after.length).toBe(before.length);
  });

  it('tenant isolation: org A sees only its own insights under RLS', async () => {
    const aRows = await runAsOrg<Array<{ id: string }>>(fixture.db, orgA, (tx) =>
      tx.select({ id: postInsights.id }).from(postInsights),
    );
    const bRows = await runAsOrg<Array<{ id: string; targetId: string }>>(fixture.db, orgB, (tx) =>
      tx.select({ id: postInsights.id, targetId: postInsights.postTargetId }).from(postInsights),
    );
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(1);
    expect(bRows[0]?.targetId).toBe(t2);
  });
});
