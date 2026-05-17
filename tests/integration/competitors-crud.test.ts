import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs, type AnyPgTx } from '../../lib/db/client';
import {
  brands,
  competitorMetricsDaily,
  competitors,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import {
  getCompetitorsAggregateWithTx,
  listCompetitorsWithTx,
} from '../../lib/competitors/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 34 — competitors CRUD + tenant isolation +
 * aggregate math.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3400c3400c0';
const orgA = '11111111-1111-4111-8111-c3400c3400c0';
const orgB = '11111111-1111-4111-8111-c3400c3400c1';
const userA = '22222222-2222-4222-8222-c3400c3400c0';
const userB = '22222222-2222-4222-8222-c3400c3400c1';
const competitorA = '88888888-8888-4888-8888-c3400c3400c0';
const brandA = '33333333-3333-4333-8333-c3400c3400c0';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'growth',
      name: 'Growth',
      priceCents: 29900,
    });
    await tx.insert(users).values([
      { id: userA, email: 'a@c34.test', name: 'A' },
      { id: userB, email: 'b@c34.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c34-a', planId },
      { id: orgB, name: 'Org B', slug: 'c34-b', planId },
    ]);
    await tx.insert(brands).values({
      id: brandA,
      organizationId: orgA,
      name: 'Brand A',
      slug: 'c34-brand-a',
    });
    await tx.insert(competitors).values({
      id: competitorA,
      organizationId: orgA,
      brandId: brandA,
      name: 'Brand Rival',
      platforms: ['instagram', 'x'],
      handles: { instagram: '@rival', x: '@rival' },
      status: 'active',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const asAdminTx = <T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> =>
  runAdmin(fixture.db, fn);

describe('competitors CRUD', () => {
  it('list returns the org A row', async () => {
    const rows = await asAdminTx((tx) =>
      listCompetitorsWithTx(tx, orgA),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Brand Rival');
    expect(rows[0]!.handles.instagram).toBe('@rival');
  });

  it('unique constraint blocks duplicate (org, brand, name)', async () => {
    await expect(
      asAdminTx((tx) =>
        tx.insert(competitors).values({
          organizationId: orgA,
          brandId: brandA,
          name: 'Brand Rival',
          platforms: ['instagram'],
        }),
      ),
    ).rejects.toThrow();
  });

  it('platforms CHECK rejects empty array', async () => {
    await expect(
      asAdminTx((tx) =>
        tx.insert(competitors).values({
          organizationId: orgA,
          name: 'Empty platforms',
          platforms: [],
        }),
      ),
    ).rejects.toThrow();
  });

  it('tenant isolation: org B sees no rows', async () => {
    type Row = { id: string };
    const rows = (await runAs(
      fixture.db,
      { orgId: orgB, userId: userB },
      (tx) => tx.select({ id: competitors.id }).from(competitors),
    )) as Row[];
    expect(rows).toHaveLength(0);
  });

  it('SoV CHECK rejects values outside [0, 1]', async () => {
    await expect(
      asAdminTx((tx) =>
        tx.insert(competitorMetricsDaily).values({
          organizationId: orgA,
          competitorId: competitorA,
          platform: 'instagram',
          day: '2026-05-17',
          shareOfVoice: '1.50',
        }),
      ),
    ).rejects.toThrow();
  });

  it('aggregate computes SoV avg across (competitor, platform, day) tuples', async () => {
    await asAdminTx(async (tx) => {
      await tx.insert(competitorMetricsDaily).values([
        {
          organizationId: orgA,
          competitorId: competitorA,
          platform: 'instagram',
          day: '2026-05-15',
          postsCount: 10,
          engagementTotal: 1000,
          sentimentScore: '0.40',
          shareOfVoice: '0.500',
        },
        {
          organizationId: orgA,
          competitorId: competitorA,
          platform: 'x',
          day: '2026-05-15',
          postsCount: 5,
          engagementTotal: 500,
          sentimentScore: '0.20',
          shareOfVoice: '0.300',
        },
      ]);
    });
    const agg = await asAdminTx((tx) =>
      getCompetitorsAggregateWithTx(tx, orgA, 30),
    );
    expect(agg.competitorCount).toBe(1);
    expect(agg.totalPosts).toBe(15);
    expect(agg.avgShareOfVoice).toBeGreaterThan(0);
    expect(agg.avgShareOfVoice).toBeLessThanOrEqual(1);
  });
});
