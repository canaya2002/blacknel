/**
 * THE most important test of the project: cross-tenant reads must be
 * impossible through the `dbAs()` codepath. If this test ever goes red,
 * every Server Action and Route Handler is suspect — pause everything
 * else until it's green again.
 *
 * The test exercises the full RLS plumbing end-to-end:
 *
 *   1. Boot a fresh pglite, apply migrations 0000–0003.
 *   2. Seed two organizations, two users (one in each org), two brands
 *      (one per org). Done via `runAdmin` so seed itself bypasses RLS.
 *   3. Switch to `runAs(orgA, userA)` and verify that:
 *        a. `SELECT * FROM brands` returns ONLY org A's brand.
 *        b. A SELECT explicitly filtering for org B's id returns []
 *           even though org B's brand exists in the table.
 *        c. The same query as user B sees only org B's brand.
 *   4. Sanity-check that `runAdmin` still sees the full set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  type Brand,
  brands,
  organizationMembers,
  organizations,
  plans,
  type User,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-000000000001';
const orgA = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const orgB = '22222222-2222-4222-8222-bbbbbbbbbbbb';
const userA = '33333333-3333-4333-8333-aaaaaaaaaaaa';
const userB = '33333333-3333-4333-8333-bbbbbbbbbbbb';
const brandA = '44444444-4444-4444-8444-aaaaaaaaaaaa';
const brandB = '44444444-4444-4444-8444-bbbbbbbbbbbb';

beforeAll(async () => {
  fixture = await createTestDb();

  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'standard',
      name: 'Standard',
      priceCents: 6900,
    });

    await tx.insert(users).values([
      { id: userA, email: 'user-a@blacknel.test', name: 'User A' },
      { id: userB, email: 'user-b@blacknel.test', name: 'User B' },
    ]);

    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'org-a', planId },
      { id: orgB, name: 'Org B', slug: 'org-b', planId },
    ]);

    await tx.insert(organizationMembers).values([
      { organizationId: orgA, userId: userA, role: 'owner', status: 'active' },
      { organizationId: orgB, userId: userB, role: 'owner', status: 'active' },
    ]);

    await tx.insert(brands).values([
      { id: brandA, organizationId: orgA, name: 'Brand A', slug: 'brand-a' },
      { id: brandB, organizationId: orgB, name: 'Brand B', slug: 'brand-b' },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('RLS: tenant isolation on brands', () => {
  it('user A authed in org A sees only org A brands', async () => {
    const visible = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) => tx.select().from(brands),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(brandA);
    expect(visible[0]?.organizationId).toBe(orgA);
  });

  it('user A explicitly querying for org B brand returns []', async () => {
    const result = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx.select().from(brands).where(eq(brands.organizationId, orgB)),
    );
    expect(result).toEqual([]);
  });

  it('user B authed in org B sees only org B brands', async () => {
    const visible = await runAs(
      fixture.db,
      { orgId: orgB, userId: userB },
      async (tx) => tx.select().from(brands),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(brandB);
    expect(visible[0]?.organizationId).toBe(orgB);
  });

  it('runAdmin (RLS bypass) sees both brands', async () => {
    const all = await runAdmin<Brand[]>(fixture.db, async (tx) =>
      tx.select().from(brands),
    );
    const ids = all.map((b) => b.id).sort();
    expect(ids).toEqual([brandA, brandB].sort());
  });
});

describe('RLS: tenant isolation on organizations', () => {
  it('user A only sees org A in the organizations table', async () => {
    const visible = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) => tx.select().from(organizations),
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe(orgA);
  });

  it('user A cannot read org B even with explicit id filter', async () => {
    const result = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx.select().from(organizations).where(eq(organizations.id, orgB)),
    );
    expect(result).toEqual([]);
  });
});

describe('RLS: users table', () => {
  it('user A sees self plus other members of org A', async () => {
    // Currently only user A is a member of org A.
    const visible = await runAs<User[]>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) => tx.select().from(users),
    );
    const ids = visible.map((u) => u.id);
    expect(ids).toContain(userA);
    expect(ids).not.toContain(userB);
  });
});
