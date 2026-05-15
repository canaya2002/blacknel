/**
 * LIVE RLS verification — runs against the real Postgres at `DATABASE_URL`.
 *
 * MANUAL ONLY. Skipped by default; runs only when both of:
 *
 *   RLS_LIVE_TEST=true
 *   DATABASE_URL=postgres://...
 *
 * are set. Having `DATABASE_URL` alone is NOT enough — the explicit
 * `RLS_LIVE_TEST` flag prevents an accidental run when a developer's
 * `.env.local` happens to point at a real DB. CI does not set the flag,
 * so this file silently skips there.
 *
 * Invocation:
 *
 *   RLS_LIVE_TEST=true \
 *   BLACKNEL_USE_MOCKS=false \
 *   DATABASE_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres \
 *   pnpm vitest run tests/integration/rls.live.test.ts
 *
 * The `BLACKNEL_USE_MOCKS=false` flag is what routes `getRawDb()` to
 * postgres-js instead of the pglite dev runtime — leaving it on
 * (default) would point at the local `.blacknel/pglite-data/` instead
 * of the configured DATABASE_URL.
 *
 * Reproduces the seven cases from `rls.test.ts` against real Postgres.
 * Inserts rows under sentinel UUIDs (prefix `9e9e`) so they are easy to
 * spot in audits and easy to clean up if the run is interrupted:
 *
 *   DELETE FROM brands               WHERE id::text         LIKE '9e9e%';
 *   DELETE FROM organization_members WHERE user_id::text    LIKE '9e9e%'
 *                                       OR organization_id::text LIKE '9e9e%';
 *   DELETE FROM organizations        WHERE id::text         LIKE '9e9e%';
 *   DELETE FROM users                WHERE id::text         LIKE '9e9e%';
 *
 * Pre-requisites: migrations 0000–0003 applied; `plans` seeded (the
 * standard plan id is looked up at the start of the run).
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeProdDb, getRawDb, runAdmin, runAs } from '../../lib/db/client';
import {
  type Brand,
  brands,
  organizationMembers,
  organizations,
  plans,
  type User,
  users,
} from '../../lib/db/schema';
import { env } from '../../lib/env';

const LIVE_ENABLED =
  process.env.RLS_LIVE_TEST === 'true' && Boolean(env.DATABASE_URL);

const describeLive = LIVE_ENABLED ? describe : describe.skip;

// Sentinel UUIDs — every "live test" row starts with `9e9e9e9e`. Easy to
// audit in a busy DB and easy to cleanup with a LIKE filter.
const orgA = '9e9e9e9e-0001-4000-8000-000000000001';
const orgB = '9e9e9e9e-0001-4000-8000-000000000002';
const userA = '9e9e9e9e-0002-4000-8000-000000000001';
const userB = '9e9e9e9e-0002-4000-8000-000000000002';
const brandA = '9e9e9e9e-0003-4000-8000-000000000001';
const brandB = '9e9e9e9e-0003-4000-8000-000000000002';

describeLive('RLS LIVE (against DATABASE_URL)', () => {
  let planId: string;

  beforeAll(async () => {
    const db = await getRawDb();

    // Pull the seeded `standard` plan id. If seed has not run, fail fast.
    const planRows = await runAdmin<Array<{ id: string }>>(db, async (tx) =>
      tx
        .select({ id: plans.id })
        .from(plans)
        .where(eq(plans.code, 'standard'))
        .limit(1),
    );
    if (!planRows[0]) {
      throw new Error(
        'Live RLS test requires `plans` to be seeded. Run `pnpm db:seed` first.',
      );
    }
    planId = planRows[0].id;

    // Seed sentinel data. `onConflictDoNothing` keeps the script
    // idempotent if a previous interrupted run already inserted some
    // rows.
    await runAdmin(db, async (tx) => {
      await tx
        .insert(users)
        .values([
          {
            id: userA,
            email: '9e9e-live-user-a@blacknel.test',
            name: 'Live Test User A',
          },
          {
            id: userB,
            email: '9e9e-live-user-b@blacknel.test',
            name: 'Live Test User B',
          },
        ])
        .onConflictDoNothing();

      await tx
        .insert(organizations)
        .values([
          {
            id: orgA,
            name: '9e9e Live Test Org A',
            slug: '9e9e-live-test-org-a',
            planId,
          },
          {
            id: orgB,
            name: '9e9e Live Test Org B',
            slug: '9e9e-live-test-org-b',
            planId,
          },
        ])
        .onConflictDoNothing();

      await tx
        .insert(organizationMembers)
        .values([
          {
            organizationId: orgA,
            userId: userA,
            role: 'owner',
            status: 'active',
          },
          {
            organizationId: orgB,
            userId: userB,
            role: 'owner',
            status: 'active',
          },
        ])
        .onConflictDoNothing();

      await tx
        .insert(brands)
        .values([
          {
            id: brandA,
            organizationId: orgA,
            name: '9e9e Live Brand A',
            slug: '9e9e-live-brand-a',
          },
          {
            id: brandB,
            organizationId: orgB,
            name: '9e9e Live Brand B',
            slug: '9e9e-live-brand-b',
          },
        ])
        .onConflictDoNothing();
    });
  }, 60_000);

  afterAll(async () => {
    const db = await getRawDb();
    await runAdmin(db, async (tx) => {
      await tx.delete(brands).where(inArray(brands.id, [brandA, brandB]));
      await tx
        .delete(organizationMembers)
        .where(inArray(organizationMembers.userId, [userA, userB]));
      await tx
        .delete(organizations)
        .where(inArray(organizations.id, [orgA, orgB]));
      await tx.delete(users).where(inArray(users.id, [userA, userB]));
    });
    await closeProdDb();
  });

  // --- 7 cases mirroring tests/integration/rls.test.ts -------------------

  describe('brands isolation', () => {
    it('user A authed in org A sees only org A brands (inside the 9e9e set)', async () => {
      const visible = await runAs<Brand[]>(
        await getRawDb(),
        { orgId: orgA, userId: userA },
        async (tx) => tx.select().from(brands),
      );
      const ourRows = visible.filter((b) =>
        b.id.startsWith('9e9e9e9e-0003'),
      );
      expect(ourRows).toHaveLength(1);
      expect(ourRows[0]?.id).toBe(brandA);
      expect(ourRows[0]?.organizationId).toBe(orgA);
    });

    it('user A querying explicitly for org B brand returns []', async () => {
      const result = await runAs<Brand[]>(
        await getRawDb(),
        { orgId: orgA, userId: userA },
        async (tx) =>
          tx.select().from(brands).where(eq(brands.organizationId, orgB)),
      );
      expect(result).toEqual([]);
    });

    it('user B authed in org B sees only org B brands (inside the 9e9e set)', async () => {
      const visible = await runAs<Brand[]>(
        await getRawDb(),
        { orgId: orgB, userId: userB },
        async (tx) => tx.select().from(brands),
      );
      const ourRows = visible.filter((b) =>
        b.id.startsWith('9e9e9e9e-0003'),
      );
      expect(ourRows).toHaveLength(1);
      expect(ourRows[0]?.id).toBe(brandB);
      expect(ourRows[0]?.organizationId).toBe(orgB);
    });

    it('runAdmin (RLS bypass) sees both 9e9e brands', async () => {
      const all = await runAdmin<Brand[]>(getRawDb(), async (tx) =>
        tx.select().from(brands).where(inArray(brands.id, [brandA, brandB])),
      );
      const ids = all.map((b) => b.id).sort();
      expect(ids).toEqual([brandA, brandB].sort());
    });
  });

  describe('organizations isolation', () => {
    it('user A only sees org A in the organizations table', async () => {
      const visible = await runAs<Array<{ id: string }>>(
        await getRawDb(),
        { orgId: orgA, userId: userA },
        async (tx) => tx.select({ id: organizations.id }).from(organizations),
      );
      expect(visible.map((o) => o.id)).toEqual([orgA]);
    });

    it('user A cannot read org B even with explicit id filter', async () => {
      const result = await runAs<Array<{ id: string }>>(
        await getRawDb(),
        { orgId: orgA, userId: userA },
        async (tx) =>
          tx
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, orgB)),
      );
      expect(result).toEqual([]);
    });
  });

  describe('users isolation', () => {
    it('user A sees self plus other members of org A', async () => {
      const visible = await runAs<User[]>(
        await getRawDb(),
        { orgId: orgA, userId: userA },
        async (tx) =>
          tx
            .select()
            .from(users)
            .where(inArray(users.id, [userA, userB])),
      );
      const ids = visible.map((u) => u.id);
      expect(ids).toContain(userA);
      expect(ids).not.toContain(userB);
    });
  });
});
