import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import { organizations, plans } from '../../lib/db/schema';
import {
  checkUsage,
  decrementUsage,
  incrementUsage,
  readUsage,
} from '../../lib/usage/counters';
import { createTestDb, type TestDb } from '../helpers/test-db';

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-aaaaaaaaaaaa';
const orgId = '11111111-1111-4111-8111-aaaaaaaaaaaa';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'standard',
      name: 'Standard',
      priceCents: 6900,
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Usage Test Org',
      slug: 'usage-test',
      planId,
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('usage counters — point-in-time metrics', () => {
  it('starts at 0 when never bumped', async () => {
    const value = await runAdmin<number>(fixture.db, async (tx) =>
      readUsage(tx, orgId, 'brands'),
    );
    expect(value).toBe(0);
  });

  it('increments and decrements correctly', async () => {
    await runAdmin(fixture.db, async (tx) => incrementUsage(tx, orgId, 'brands', 1));
    await runAdmin(fixture.db, async (tx) => incrementUsage(tx, orgId, 'brands', 2));
    const after = await runAdmin<number>(fixture.db, async (tx) =>
      readUsage(tx, orgId, 'brands'),
    );
    expect(after).toBe(3);

    await runAdmin(fixture.db, async (tx) => decrementUsage(tx, orgId, 'brands', 1));
    const dec = await runAdmin<number>(fixture.db, async (tx) =>
      readUsage(tx, orgId, 'brands'),
    );
    expect(dec).toBe(2);
  });

  it('floors at 0 on over-decrement (never negative)', async () => {
    await runAdmin(fixture.db, async (tx) => decrementUsage(tx, orgId, 'brands', 100));
    const value = await runAdmin<number>(fixture.db, async (tx) =>
      readUsage(tx, orgId, 'brands'),
    );
    expect(value).toBe(0);
  });
});

describe('usage counters — windowed (postsPerMonth)', () => {
  it('stores the current month period and reads back the value', async () => {
    await runAdmin(fixture.db, async (tx) =>
      incrementUsage(tx, orgId, 'postsPerMonth', 5),
    );
    const value = await runAdmin<number>(fixture.db, async (tx) =>
      readUsage(tx, orgId, 'postsPerMonth'),
    );
    expect(value).toBe(5);
  });
});

describe('checkUsage', () => {
  it('reports ok=true when delta fits inside the plan cap', async () => {
    const result = await runAdmin(fixture.db, async (tx) =>
      checkUsage(tx, orgId, 'standard', 'socialAccounts', 1),
    );
    expect(result.ok).toBe(true);
    expect(result.cap).toBe(5); // standard cap
    expect(result.reached).toBe(false);
  });

  it('reports ok=false when the next +1 exceeds the cap', async () => {
    await runAdmin(fixture.db, async (tx) =>
      incrementUsage(tx, orgId, 'socialAccounts', 5),
    );
    const result = await runAdmin(fixture.db, async (tx) =>
      checkUsage(tx, orgId, 'standard', 'socialAccounts', 1),
    );
    expect(result.ok).toBe(false);
    expect(result.current).toBe(5);
    expect(result.cap).toBe(5);
    expect(result.reached).toBe(true);
  });

  it('treats -1 (enterprise) as unlimited', async () => {
    const result = await runAdmin(fixture.db, async (tx) =>
      checkUsage(tx, orgId, 'enterprise', 'brands', 100),
    );
    expect(result.ok).toBe(true);
    expect(result.cap).toBe(-1);
  });
});
