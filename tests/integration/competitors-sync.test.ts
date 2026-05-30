import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CompetitorMockMetric } from '../../lib/connectors/competitors/mock';
import { runCompetitorsSync } from '../../lib/connectors/competitors-sync';
import { type AnyPgTx, runAdmin, runAsOrg } from '../../lib/db/client';
import {
  competitorMetricsDaily,
  competitors,
  organizations,
  plans,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C53 competitors sync. pglite + RLS; injected generator + own-posts (no real
 * provider). Covers: one metric row per (competitor, platform, day), idempotent
 * upsert, tenant isolation.
 */

let fixture: TestDb;
const NOW = new Date('2026-05-30T12:00:00Z');
const DAY = '2026-05-30';
const planId = '00000000-0000-4000-8000-c53c00000001';
const orgA = '11111111-1111-4111-8111-c53c00000a01';
const orgB = '11111111-1111-4111-8111-c53c00000b01';
const compA = '77777777-7777-4777-8777-c53c00000a01';
const compB = '77777777-7777-4777-8777-c53c00000b01';

const metric: CompetitorMockMetric = {
  postsCount: 10,
  engagementTotal: 1000,
  sentimentScore: 0.2,
  shareOfVoice: 0.6,
};

const deps = {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => runAsOrg(fixture.db, orgId, fn),
  generate: () => metric,
  ownPostsCount: async () => 4,
  now: () => NOW,
};

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'enterprise', name: 'Enterprise', priceCents: 109900 });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c53c-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c53c-org-b', planId },
    ]);
    await tx.insert(competitors).values([
      { id: compA, organizationId: orgA, name: 'Rival A', handles: {}, platforms: ['instagram', 'x'], status: 'active' },
      { id: compB, organizationId: orgB, name: 'Rival B', handles: {}, platforms: ['facebook'], status: 'active' },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('runCompetitorsSync', () => {
  it('upserts one metric per (competitor, platform) for the day', async () => {
    const report = await runCompetitorsSync(deps);
    expect(report.competitors).toBe(2);
    expect(report.metrics).toBe(3); // A: 2 platforms, B: 1 platform
    expect(report.failed).toBe(0);

    const rows = await runAdmin<Array<{ day: string; platform: string; postsCount: number; shareOfVoice: string }>>(
      fixture.db,
      (tx) =>
        tx
          .select({
            day: competitorMetricsDaily.day,
            platform: competitorMetricsDaily.platform,
            postsCount: competitorMetricsDaily.postsCount,
            shareOfVoice: competitorMetricsDaily.shareOfVoice,
          })
          .from(competitorMetricsDaily),
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.day === DAY)).toBe(true);
    expect(rows.every((r) => r.postsCount === 10)).toBe(true);
    expect(rows.every((r) => Number(r.shareOfVoice) === 0.6)).toBe(true);
  });

  it('is idempotent — re-run upserts in place, no duplicate rows', async () => {
    const before = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx.select({ id: competitorMetricsDaily.id }).from(competitorMetricsDaily),
    );
    await runCompetitorsSync(deps);
    const after = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx.select({ id: competitorMetricsDaily.id }).from(competitorMetricsDaily),
    );
    expect(after.length).toBe(before.length);
  });

  it('tenant isolation: org A sees only its own metrics under RLS', async () => {
    const aRows = await runAsOrg<Array<{ id: string }>>(fixture.db, orgA, (tx) =>
      tx.select({ id: competitorMetricsDaily.id }).from(competitorMetricsDaily),
    );
    const bRows = await runAsOrg<Array<{ id: string }>>(fixture.db, orgB, (tx) =>
      tx.select({ id: competitorMetricsDaily.id }).from(competitorMetricsDaily),
    );
    expect(aRows).toHaveLength(2); // 2 platforms
    expect(bRows).toHaveLength(1); // 1 platform
  });
});
