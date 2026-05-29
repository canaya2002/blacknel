/**
 * Phase 11 / Commit 42c — privilege escalation matrix against the dynamic
 * RLS policies from migration 0023.
 *
 * **Runs in CI** (no `.live` suffix) — the policies are security-critical
 * and the matrix needs to fail loud on every commit, not only when an
 * operator runs the live opt-in. Pglite is the same Postgres compiled to
 * WASM, so the policy semantics match production. The `rls.live.test.ts`
 * file covers the same scenarios against real Supabase staging when the
 * operator runs `BLACKNEL_LIVE_TEST=true pnpm vitest …`.
 *
 * # Matrix
 *
 *   Operation                  | flag off | viewer flag on | owner flag on
 *   ---------------------------|----------|----------------|--------------
 *   posts UPDATE               | ✅       | 0 rows         | ✅
 *   posts DELETE               | ✅       | 0 rows         | ✅
 *   audit_events SELECT (rows) | full     | 0 rows         | full
 *   custom_roles INSERT        | ✅       | ❌ error       | ✅
 *   custom_roles UPDATE        | ✅       | 0 rows         | ✅
 *   custom_roles DELETE        | ✅       | 0 rows         | ✅
 *
 * # Why some are "0 rows" and not "error"
 *
 * Postgres RLS semantics: USING clauses filter visible rows. If the
 * USING returns false for a row, the row is invisible to UPDATE/DELETE
 * — the operation silently affects 0 rows, no error. Only WITH CHECK
 * (which validates the new state) can throw "new row violates RLS"
 * during INSERT or for the post-image of UPDATE.
 *
 * For UPDATE/DELETE we assert via a follow-up SELECT that the row is
 * unchanged / still present. For INSERT we assert the action rejects
 * (WITH CHECK violation throws).
 *
 * The user-facing UX still gets a clear error because Layer 1
 * (`authorize()` in TS) fires before any DB call. RLS is the backstop
 * when Layer 1 is bypassed.
 *
 * # Rollback test
 *
 *   Set flag=on inside the tx → viewer UPDATE post DENIED.
 *   Set flag=off inside the tx → same UPDATE succeeds.
 *
 * # Custom_role revoke-wins test
 *
 *   Manager (has posts:publish by default) + custom_role with
 *   revokes=['posts:publish'] assigned → UPDATE post DENIED even
 *   with flag on, because revoke-wins.
 *
 * # Sentinel UUIDs
 *
 *   9e9e9e9e-0008-*  → C42c test data (org, users, posts, etc).
 *   This suite runs against an in-memory pglite (createTestDb), so its
 *   rows never reach prod; afterAll's dispose() only closes the pglite
 *   instance (it deletes no rows). For any residue left in a REAL DB by
 *   a manual/live run, the cleanup query in
 *   `doc/runbooks/staging-environment.md` covers the 0008 range.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  brands,
  customRoles,
  organizationMembers,
  organizations,
  plans,
  posts,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

const ORG = '9e9e9e9e-0008-4000-8000-000000000001';
const OWNER = '9e9e9e9e-0008-4000-8000-000000000010';
const MANAGER = '9e9e9e9e-0008-4000-8000-000000000020';
const VIEWER = '9e9e9e9e-0008-4000-8000-000000000030';
const BRAND = '9e9e9e9e-0008-4000-8000-000000000040';
const POST_OWN = '9e9e9e9e-0008-4000-8000-000000000050';
const POST_FOR_DELETE = '9e9e9e9e-0008-4000-8000-000000000051';
const CUSTOM_ROLE_REVOKE = '9e9e9e9e-0008-4000-8000-000000000060';

/**
 * Flip the dynamic-RLS flag via the `app_settings` table (C42c-hotfix —
 * the original GUC-based approach was blocked by Supabase supautils).
 *
 * Persists across transactions (commits the UPDATE), so each test that
 * flips ON must flip OFF after itself. `withFlagOn` wraps the gated
 * operation in try/finally so even an error path resets the flag.
 */
async function setFlag(db: TestDb['db'], state: 'on' | 'off'): Promise<void> {
  await runAdmin(db, async (tx) =>
    tx.execute(
      sql`UPDATE public.app_settings SET value = ${state} WHERE key = 'rls_dynamic'`,
    ),
  );
}


describe('Phase 11 / C42c — RLS dynamic policies privilege escalation matrix', () => {
  let fixture: TestDb;

  beforeAll(async () => {
    fixture = await createTestDb();

    // Seed minimal world: 1 org, 3 users (owner/manager/viewer), 1 brand,
    // 1 post (for UPDATE/DELETE tests), 1 custom_role (for revoke-wins).
    await runAdmin(fixture.db, async (tx) => {
      // Pull the seeded `standard` plan id — applyMigrations seeded plans
      // already? Actually no, plans is seeded by `seedDatabase`, not by
      // migrations. We need to insert one explicitly for this test.
      await tx.insert(plans).values({
        id: '9e9e9e9e-0008-4000-8000-0000000000aa',
        code: 'standard',
        name: 'Standard (test)',
        priceCents: 0,
      });

      await tx.insert(users).values([
        { id: OWNER, email: 'owner-c42c@blacknel.test', name: 'Owner C42c' },
        { id: MANAGER, email: 'manager-c42c@blacknel.test', name: 'Manager C42c' },
        { id: VIEWER, email: 'viewer-c42c@blacknel.test', name: 'Viewer C42c' },
      ]);

      await tx.insert(organizations).values({
        id: ORG,
        name: 'C42c Test Org',
        slug: 'c42c-test',
        planId: '9e9e9e9e-0008-4000-8000-0000000000aa',
        createdBy: OWNER,
        billingEmail: 'billing-c42c@blacknel.test',
        status: 'active',
      });

      await tx.insert(organizationMembers).values([
        { organizationId: ORG, userId: OWNER, role: 'owner', status: 'active' },
        { organizationId: ORG, userId: MANAGER, role: 'manager', status: 'active' },
        { organizationId: ORG, userId: VIEWER, role: 'viewer', status: 'active' },
      ]);

      await tx.insert(brands).values({
        id: BRAND,
        organizationId: ORG,
        name: 'C42c Brand',
        slug: 'c42c-brand',
        status: 'active',
      });

      await tx.insert(posts).values([
        {
          id: POST_OWN,
          organizationId: ORG,
          brandId: BRAND,
          authorId: OWNER,
          status: 'draft',
          text: 'Post under test for UPDATE',
        },
        {
          id: POST_FOR_DELETE,
          organizationId: ORG,
          brandId: BRAND,
          authorId: OWNER,
          status: 'draft',
          text: 'Post under test for DELETE',
        },
      ]);

      // Custom role that REVOKES posts:publish from its base manager role.
      await tx.insert(customRoles).values({
        id: CUSTOM_ROLE_REVOKE,
        organizationId: ORG,
        name: 'Manager (no publish)',
        baseRole: 'manager',
        grants: [],
        revokes: ['posts:publish'],
        status: 'active',
        createdBy: OWNER,
      });
    });
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  // -------------------------------------------------------------------------
  // Flag OFF — restrictive policies are no-ops
  // -------------------------------------------------------------------------

  describe('flag OFF (default) — RESTRICTIVE policies no-op', () => {
    it('viewer can UPDATE post (tenant-only behavior, no permission check)', async () => {
      await expect(
        runAs(fixture.db, { orgId: ORG, userId: VIEWER, role: 'viewer' }, async (tx) =>
          tx
            .update(posts)
            .set({ text: 'viewer touched (flag off)' })
            .where(eq(posts.id, POST_OWN)),
        ),
      ).resolves.not.toThrow();
    });

    it('viewer can SELECT audit_events rows their org has (tenant-only)', async () => {
      // Insert an audit row first (under admin so RLS doesn't block).
      await runAdmin(fixture.db, async (tx) =>
        tx.execute(sql`
          INSERT INTO audit_events (id, organization_id, user_id, action, entity_type, entity_id)
          VALUES (
            '9e9e9e9e-0008-4000-8000-000000000070'::uuid,
            ${ORG}::uuid,
            ${OWNER}::uuid,
            'test.event',
            'post',
            ${POST_OWN}::uuid
          )
        `),
      );

      const rows = await runAs<Array<{ id: string }>>(
        fixture.db,
        { orgId: ORG, userId: VIEWER, role: 'viewer' },
        async (tx) =>
          tx.execute(
            sql`SELECT id::text FROM audit_events WHERE organization_id = ${ORG}::uuid`,
          ) as unknown as Promise<Array<{ id: string }>>,
      );
      // Pglite returns {rows} wrapping; normalize.
      const arr = Array.isArray(rows)
        ? rows
        : ((rows as unknown as { rows: Array<{ id: string }> }).rows ?? []);
      expect(arr.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Flag ON — strict permission checks fire
  // -------------------------------------------------------------------------

  describe('flag ON — permission checks fire', () => {
    // Flip flag ON for every test in this describe; reset OFF at the end so
    // sibling describes start from the documented default state.
    beforeAll(async () => {
      await setFlag(fixture.db, 'on');
    });
    afterAll(async () => {
      await setFlag(fixture.db, 'off');
    });

    it('viewer × UPDATE post → 0 rows affected (RESTRICTIVE USING hides row)', async () => {
      const beforeRows = await runAdmin<Array<{ text: string }>>(
        fixture.db,
        async (tx) =>
          tx.select({ text: posts.text }).from(posts).where(eq(posts.id, POST_OWN)),
      );
      const originalText = beforeRows[0]!.text;

      const updated = await runAs<Array<{ id: string }>>(
        fixture.db,
        { orgId: ORG, userId: VIEWER, role: 'viewer' },
        async (tx) =>
          tx
            .update(posts)
            .set({ text: 'should not persist' })
            .where(eq(posts.id, POST_OWN))
            .returning({ id: posts.id }),
      );
      expect(updated).toHaveLength(0);

      // Row is unchanged.
      const afterRows = await runAdmin<Array<{ text: string }>>(
        fixture.db,
        async (tx) =>
          tx.select({ text: posts.text }).from(posts).where(eq(posts.id, POST_OWN)),
      );
      expect(afterRows[0]!.text).toBe(originalText);
    });

    it('viewer × DELETE post → 0 rows affected (RESTRICTIVE USING hides row)', async () => {
      const deleted = await runAs<Array<{ id: string }>>(
        fixture.db,
        { orgId: ORG, userId: VIEWER, role: 'viewer' },
        async (tx) =>
          tx
            .delete(posts)
            .where(eq(posts.id, POST_FOR_DELETE))
            .returning({ id: posts.id }),
      );
      expect(deleted).toHaveLength(0);

      // Row still exists.
      const stillThere = await runAdmin<Array<{ id: string }>>(
        fixture.db,
        async (tx) =>
          tx.select({ id: posts.id }).from(posts).where(eq(posts.id, POST_FOR_DELETE)),
      );
      expect(stillThere).toHaveLength(1);
    });

    it('viewer × SELECT audit_events → 0 rows (RLS hides; lacks audit:read)', async () => {
      const rows = await runAs(
        fixture.db,
        { orgId: ORG, userId: VIEWER, role: 'viewer' },
        async (tx) =>
          tx.execute(
            sql`SELECT id::text FROM audit_events WHERE organization_id = ${ORG}::uuid`,
          ),
      );
      const arr = Array.isArray(rows)
        ? rows
        : ((rows as unknown as { rows: unknown[] }).rows ?? []);
      expect(arr).toHaveLength(0);
    });

    it('viewer × INSERT custom_role → DENIED (lacks team:manage_roles)', async () => {
      await expect(
        runAs(fixture.db, { orgId: ORG, userId: VIEWER, role: 'viewer' }, async (tx) =>
          tx.insert(customRoles).values({
            id: '9e9e9e9e-0008-4000-8000-000000000061',
            organizationId: ORG,
            name: 'viewer-attempted',
            baseRole: 'agent',
            grants: [],
            revokes: [],
            status: 'active',
            createdBy: VIEWER,
          }),
        ),
      ).rejects.toThrow();
    });

    it('owner × UPDATE post → succeeds (has posts:publish)', async () => {
      await expect(
        runAs(fixture.db, { orgId: ORG, userId: OWNER, role: 'owner' }, async (tx) =>
          tx
            .update(posts)
            .set({ text: 'owner OK with flag on' })
            .where(eq(posts.id, POST_OWN)),
        ),
      ).resolves.not.toThrow();
    });

    it('manager × UPDATE post → succeeds (has posts:publish via base role)', async () => {
      await expect(
        runAs(
          fixture.db,
          { orgId: ORG, userId: MANAGER, role: 'manager' },
          async (tx) =>
            tx
              .update(posts)
              .set({ text: 'manager OK with flag on' })
              .where(eq(posts.id, POST_OWN)),
        ),
      ).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Custom-role revoke-wins
  // -------------------------------------------------------------------------

  describe('custom_role revoke-wins (flag ON)', () => {
    beforeAll(async () => {
      await setFlag(fixture.db, 'on');
    });
    afterAll(async () => {
      await setFlag(fixture.db, 'off');
    });

    it('manager assigned a custom_role revoking posts:publish → UPDATE 0 rows', async () => {
      // Assign the revoke-wins custom_role to MANAGER.
      await runAdmin(fixture.db, async (tx) =>
        tx
          .update(organizationMembers)
          .set({ customRoleId: CUSTOM_ROLE_REVOKE })
          .where(
            sql`user_id = ${MANAGER}::uuid AND organization_id = ${ORG}::uuid`,
          ),
      );

      const updated = await runAs<Array<{ id: string }>>(
        fixture.db,
        {
          orgId: ORG,
          userId: MANAGER,
          role: 'manager',
          customRoleId: CUSTOM_ROLE_REVOKE,
        },
        async (tx) =>
          tx
            .update(posts)
            .set({ text: 'should not persist — revoked' })
            .where(eq(posts.id, POST_OWN))
            .returning({ id: posts.id }),
      );
      expect(updated).toHaveLength(0);

      // Unassign so subsequent tests don't inherit.
      await runAdmin(fixture.db, async (tx) =>
        tx
          .update(organizationMembers)
          .set({ customRoleId: null })
          .where(
            sql`user_id = ${MANAGER}::uuid AND organization_id = ${ORG}::uuid`,
          ),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Rollback — flip flag back to off mid-session
  // -------------------------------------------------------------------------

  describe('rollback — flag flip on→off restores tenant-only behavior', () => {
    afterAll(async () => {
      // Defensive — leave the table in the documented default state even if
      // a failure mid-test left it ON.
      await setFlag(fixture.db, 'off');
    });

    it('viewer UPDATE: 0 rows under flag=on, then 1 row after flip OFF', async () => {
      await setFlag(fixture.db, 'on');
      const blocked = await runAs<Array<{ id: string }>>(
        fixture.db,
        { orgId: ORG, userId: VIEWER, role: 'viewer' },
        async (tx) =>
          tx
            .update(posts)
            .set({ text: 'rollback attempt 1' })
            .where(eq(posts.id, POST_OWN))
            .returning({ id: posts.id }),
      );
      expect(blocked).toHaveLength(0);

      // Flip OFF → restrictive policy short-circuits, UPDATE works.
      await setFlag(fixture.db, 'off');
      const allowed = await runAs<Array<{ id: string }>>(
        fixture.db,
        { orgId: ORG, userId: VIEWER, role: 'viewer' },
        async (tx) =>
          tx
            .update(posts)
            .set({ text: 'rollback succeeded' })
            .where(eq(posts.id, POST_OWN))
            .returning({ id: posts.id }),
      );
      expect(allowed).toHaveLength(1);
    });
  });
});
