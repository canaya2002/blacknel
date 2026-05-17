import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  brands,
  competitorMetricsDaily,
  competitors,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { getCompetitorDetailWithTx } from '../../lib/competitors/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 35 — competitor detail query (drives the new
 * `/competitors/[id]` page).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3500c3500c0';
const orgId = '11111111-1111-4111-8111-c3500c3500c0';
const userId = '22222222-2222-4222-8222-c3500c3500c0';
const brandId = '33333333-3333-4333-8333-c3500c3500c0';
const competitorId = '88888888-8888-4888-8888-c3500c3500c0';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'growth',
      name: 'Growth',
      priceCents: 29900,
    });
    await tx.insert(users).values({
      id: userId,
      email: 'a@c3500.test',
      name: 'A',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Detail Org',
      slug: 'c3500-detail',
      planId,
    });
    await tx.insert(brands).values({
      id: brandId,
      organizationId: orgId,
      name: 'Brand A',
      slug: 'c35-brand-a',
    });
    await tx.insert(competitors).values({
      id: competitorId,
      organizationId: orgId,
      brandId,
      name: 'Detail Rival',
      platforms: ['instagram', 'x'],
      handles: { instagram: '@rival', x: '@rival_handle' },
      status: 'active',
    });
    // 5 days of metrics across 2 platforms.
    const today = new Date();
    const rows: Array<typeof competitorMetricsDaily.$inferInsert> = [];
    for (let d = 0; d < 5; d += 1) {
      const day = new Date(today.getTime() - d * 86_400_000)
        .toISOString()
        .slice(0, 10);
      rows.push({
        organizationId: orgId,
        competitorId,
        platform: 'instagram',
        day,
        postsCount: 10 + d,
        engagementTotal: 100 + d * 10,
        sentimentScore: '0.40',
        shareOfVoice: '0.500',
      });
      rows.push({
        organizationId: orgId,
        competitorId,
        platform: 'x',
        day,
        postsCount: 5 + d,
        engagementTotal: 80 + d * 5,
        sentimentScore: '0.20',
        shareOfVoice: '0.300',
      });
    }
    await tx.insert(competitorMetricsDaily).values(rows);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const asAdminTx = <T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> =>
  runAdmin(fixture.db, fn);

describe('getCompetitorDetail', () => {
  it('returns the competitor + breakdown grouped by platform', async () => {
    const detail = await asAdminTx((tx) =>
      getCompetitorDetailWithTx(tx, orgId, competitorId),
    );
    expect(detail).not.toBeNull();
    expect(detail!.competitor.name).toBe('Detail Rival');
    expect(detail!.competitor.brandName).toBe('Brand A');
    expect(detail!.competitor.platforms).toEqual(['instagram', 'x']);
    expect(detail!.breakdown).toHaveLength(2);
    const inst = detail!.breakdown.find((b) => b.platform === 'instagram');
    expect(inst).toBeDefined();
    expect(inst!.postsLast30d).toBe(10 + 11 + 12 + 13 + 14);
    expect(inst!.avgShareOfVoice).toBe(0.5);
  });

  it('returns null for an unknown competitor id', async () => {
    const detail = await asAdminTx((tx) =>
      getCompetitorDetailWithTx(
        tx,
        orgId,
        '00000000-0000-4000-8000-000000009999',
      ),
    );
    expect(detail).toBeNull();
  });

  it('trend rows are ordered by day ASC', async () => {
    const detail = await asAdminTx((tx) =>
      getCompetitorDetailWithTx(tx, orgId, competitorId),
    );
    expect(detail).not.toBeNull();
    const days = detail!.trendLast30d.map((t) => t.day);
    const sorted = [...days].sort();
    expect(days).toEqual(sorted);
  });
});
