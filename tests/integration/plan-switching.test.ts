import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import {
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { getPlanLimit } from '../../lib/plans/limits';
import { incrementUsage, readUsage } from '../../lib/usage/counters';
import { createTestDb, type TestDb } from '../helpers/test-db';

let fixture: TestDb;

const standardId = '00000000-0000-4000-8000-c00000000001';
const growthId = '00000000-0000-4000-8000-c00000000002';
const enterpriseId = '00000000-0000-4000-8000-c00000000003';
const orgId = '11111111-1111-4111-8111-cccccccccccc';
const ownerId = '22222222-2222-4222-8222-cccccccccccc';

const METRICS = ['brands', 'users', 'socialAccounts', 'locations'] as const;

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values([
      { id: standardId, code: 'standard', name: 'Standard', priceCents: 6900 },
      { id: growthId, code: 'growth', name: 'Growth', priceCents: 29900 },
      { id: enterpriseId, code: 'enterprise', name: 'Enterprise', priceCents: 109900 },
    ]);
    await tx.insert(users).values({
      id: ownerId,
      email: 'owner@plans.test',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Plan Switching Org',
      slug: 'plans-test',
      planId: growthId,
      createdBy: ownerId,
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('plan downgrade safety', () => {
  it('upgrading is always allowed regardless of usage', async () => {
    // Pretend org has 50 social accounts (impossible on standard, fine on growth → enterprise).
    await runAdmin(fixture.db, async (tx) =>
      incrementUsage(tx, orgId, 'socialAccounts', 50),
    );

    // Simulate the check the changePlanAction performs.
    const blockers: Array<{ metric: string; current: number; cap: number }> = [];
    await runAdmin(fixture.db, async (tx) => {
      for (const metric of METRICS) {
        const cap = getPlanLimit('enterprise', metric);
        if (cap === -1) continue;
        const current = await readUsage(tx, orgId, metric);
        if (current > cap) blockers.push({ metric, current, cap });
      }
    });
    expect(blockers).toEqual([]);
  });

  it('downgrading is blocked when current usage exceeds the new cap', async () => {
    // From growth → standard, with socialAccounts already at 50 from the
    // previous test, standard's cap is 5 — should block.
    const blockers: Array<{ metric: string; current: number; cap: number }> = [];
    await runAdmin(fixture.db, async (tx) => {
      for (const metric of METRICS) {
        const cap = getPlanLimit('standard', metric);
        if (cap === -1) continue;
        const current = await readUsage(tx, orgId, metric);
        if (current > cap) blockers.push({ metric, current, cap });
      }
    });
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.some((b) => b.metric === 'socialAccounts')).toBe(true);
  });
});
