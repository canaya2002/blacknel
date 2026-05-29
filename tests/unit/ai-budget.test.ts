import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import {
  AI_MONTHLY_COST_CEILING_CENTS,
  assertWithinBudget,
  exceedsCostCeiling,
  recordGeneration,
  _resetRunAdminForTests,
  _setRunAdminForTests,
} from '../../lib/ai/budget';
import { aiGenerations, organizations, plans } from '../../lib/db/schema';
import { incrementUsage, readUsage } from '../../lib/usage/counters';
import { createTestDb, type TestDb } from '../helpers/test-db';

describe('exceedsCostCeiling (pure)', () => {
  it('standard ceiling = 2500¢', () => {
    expect(exceedsCostCeiling('standard', 2_499)).toBe(false);
    expect(exceedsCostCeiling('standard', 2_500)).toBe(true);
  });
  it('growth = 15000¢, enterprise = 75000¢', () => {
    expect(exceedsCostCeiling('growth', 14_999)).toBe(false);
    expect(exceedsCostCeiling('growth', 15_000)).toBe(true);
    expect(exceedsCostCeiling('enterprise', 74_999)).toBe(false);
    expect(exceedsCostCeiling('enterprise', 75_000)).toBe(true);
  });
});

describe('assertWithinBudget + recordGeneration (persisted)', () => {
  let fixture: TestDb;
  const planId = '00000000-0000-4000-8000-cccccccccccc';
  const orgFresh = '33333333-3333-4333-8333-c00000000001';
  const orgCount = '33333333-3333-4333-8333-c00000000002';
  const orgCost = '33333333-3333-4333-8333-c00000000003';

  beforeAll(async () => {
    fixture = await createTestDb();
    await runAdmin(fixture.db, async (tx) => {
      await tx
        .insert(plans)
        .values({ id: planId, code: 'standard', name: 'Standard', priceCents: 6900 });
      for (const [id, slug] of [
        [orgFresh, 'b-fresh'],
        [orgCount, 'b-count'],
        [orgCost, 'b-cost'],
      ] as const) {
        await tx
          .insert(organizations)
          .values({ id, name: 'Budget Org', slug, planId });
      }
    });
    _setRunAdminForTests((fn) => runAdmin(fixture.db, fn));
  }, 60_000);

  afterAll(async () => {
    _resetRunAdminForTests();
    await fixture.dispose();
  });

  it('does not throw for a fresh org under both caps', async () => {
    await expect(assertWithinBudget(orgFresh, 'standard')).resolves.toBeUndefined();
  });

  it('recordGeneration increments the monthly counter', async () => {
    await recordGeneration(orgFresh);
    const n = await runAdmin(fixture.db, (tx) =>
      readUsage(tx, orgFresh, 'aiGenerationsPerMonth'),
    );
    expect(n).toBe(1);
  });

  it('throws budget_exceeded when the generation-count cap is hit', async () => {
    await runAdmin(fixture.db, (tx) =>
      incrementUsage(tx, orgCount, 'aiGenerationsPerMonth', 50),
    );
    await expect(assertWithinBudget(orgCount, 'standard')).rejects.toMatchObject({
      code: 'budget_exceeded',
    });
  });

  it('throws budget_exceeded when the cost ceiling is hit (count still under)', async () => {
    await runAdmin(fixture.db, (tx) =>
      tx.insert(aiGenerations).values({
        organizationId: orgCost,
        actorType: 'system',
        skill: 'caption',
        model: 'claude-haiku-4-5',
        requestHash: 'rh-cost',
        entityType: 'post',
        costCents: AI_MONTHLY_COST_CEILING_CENTS.standard, // exactly at ceiling
      }),
    );
    await expect(assertWithinBudget(orgCost, 'standard')).rejects.toMatchObject({
      code: 'budget_exceeded',
    });
  });

  it('Growth has unlimited count — only the cost ceiling guards it', async () => {
    // orgFresh: count=1 (recorded above), no AI cost rows → under Growth ceiling.
    await expect(assertWithinBudget(orgFresh, 'growth')).resolves.toBeUndefined();
  });
});
