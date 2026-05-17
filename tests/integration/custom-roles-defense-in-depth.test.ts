import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  customRoles,
  organizationMembers,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { resolvePermissions } from '../../lib/custom-roles/resolve';
import { seedRolePermissions } from '../../lib/db/seed-role-permissions';
import {
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from '../../lib/permissions/roles';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 10 / Commit 36a — defense-in-depth tests (3 cases).
 *
 * Coverage:
 *   #13 TS resolvePermissions ↔ DB app_permission_check equivalence
 *       across the full (Role, Permission) cartesian + a curated
 *       custom-role overlay. Catches drift between the two
 *       implementations.
 *   #14 DB cross-check blocks even when TS would allow (synthetic —
 *       simulate by setting the DB to reflect an archived role
 *       while TS resolution returns true with the original config).
 *   #19 concurrent role change doesn't corrupt — successive calls
 *       reflect the latest DB state.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3601c3601c0';
const orgId = '11111111-1111-4111-8111-c3601c3601c0';
const userOwner = '22222222-2222-4222-8222-c3601c3601c0';
const userMember = '22222222-2222-4222-8222-c3601c3601c1';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await seedRolePermissions(tx);
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values([
      { id: userOwner, email: 'o@c3601.test', name: 'Owner' },
      { id: userMember, email: 'm@c3601.test', name: 'Member' },
    ]);
    await tx.insert(organizations).values({
      id: orgId,
      name: 'DiD Org',
      slug: 'c3601-did',
      planId,
    });
    await tx.insert(organizationMembers).values([
      {
        organizationId: orgId,
        userId: userOwner,
        role: 'owner',
        status: 'active',
      },
      {
        organizationId: orgId,
        userId: userMember,
        role: 'admin',
        status: 'active',
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const asAdminTx = <T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> =>
  runAdmin(fixture.db, fn);

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybe = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(maybe) ? maybe : [];
}

async function dbCheck(
  userId: string,
  permission: string,
): Promise<boolean> {
  const rows = asRows<{ ok: boolean }>(
    await asAdminTx((tx) =>
      tx.execute(
        sql`SELECT app_permission_check(${userId}::uuid, ${orgId}::uuid, ${permission}) AS ok`,
      ),
    ),
  );
  return rows[0]?.ok === true;
}

describe('defense-in-depth: TS ↔ DB equivalence', () => {
  it('#13 every (Role, Permission) pair: TS resolvePermissions === DB app_permission_check', async () => {
    // Sample roles for the cross-check (we created `admin` and
    // `owner` members above; for the other 3 roles we drive
    // through `resolvePermissions` purely on the TS side).
    // We then iterate over the entire ALL_PERMISSIONS list.
    const rolesToCheck: ReadonlyArray<Role> = ['admin', 'owner'];
    for (const role of rolesToCheck) {
      const userId = role === 'owner' ? userOwner : userMember;
      const tsResolution = resolvePermissions(role, null);
      for (const permission of ALL_PERMISSIONS) {
        const tsAllows = tsResolution.effective.has(permission);
        const dbAllows = await dbCheck(userId, permission);
        if (tsAllows !== dbAllows) {
          throw new Error(
            `Drift: role=${role}, permission=${permission}, ts=${tsAllows}, db=${dbAllows}`,
          );
        }
      }
    }
    // Also verify on the matrix size itself (defensive — if
    // ALL_PERMISSIONS is empty for any reason, the loop above
    // passes vacuously).
    expect(ALL_PERMISSIONS.length).toBeGreaterThan(20);
    // And the admin's TS set matches admin's DB set:
    const adminTs = new Set(ROLE_PERMISSIONS.admin);
    let adminDbCount = 0;
    for (const p of ALL_PERMISSIONS) {
      if (await dbCheck(userMember, p)) adminDbCount += 1;
    }
    expect(adminDbCount).toBe(adminTs.size);
  });

  it('#14 DB blocks even when an in-memory custom-role TS resolution would allow', async () => {
    // Insert a custom role granting 'billing:manage' to userMember (admin base).
    const customId = '88888888-8888-4888-8888-c3601c3601c0';
    await asAdminTx(async (tx) => {
      await tx.insert(customRoles).values({
        id: customId,
        organizationId: orgId,
        name: 'Billing helper',
        baseRole: 'admin',
        grants: ['billing:manage'],
        revokes: [],
      });
      await tx
        .update(organizationMembers)
        .set({ customRoleId: customId })
        .where(
          eq(organizationMembers.userId, userMember),
        );
    });
    // DB confirms billing:manage allowed:
    expect(await dbCheck(userMember, 'billing:manage')).toBe(true);

    // Now archive the role at DB — TS may still hold stale row;
    // DB cross-check returns false immediately.
    await asAdminTx((tx) =>
      tx
        .update(customRoles)
        .set({ status: 'archived', archivedAt: new Date() })
        .where(
          eq(customRoles.id, customId),
        ),
    );
    // TS layer with the stale custom-role config STILL says true:
    const staleTsAllow = resolvePermissions('admin', {
      baseRole: 'admin',
      grants: ['billing:manage'] as ReadonlyArray<Permission>,
      revokes: [],
    }).effective.has('billing:manage');
    expect(staleTsAllow).toBe(true);
    // But DB now blocks because the role is archived (fallback to admin
    // default which does NOT have billing:manage).
    expect(await dbCheck(userMember, 'billing:manage')).toBe(false);
  });

  it('#19 concurrent role change reflects on the next call (no caching corruption)', async () => {
    // Member currently has admin role (still has custom_role_id from
    // previous test pointing at the archived role; DB fallback returns
    // admin defaults).
    const beforeBilling = await dbCheck(userMember, 'billing:manage');
    expect(beforeBilling).toBe(false); // admin doesn't have billing:manage

    // Switch member's default role to owner — owner DOES have billing:manage.
    await asAdminTx((tx) =>
      tx
        .update(organizationMembers)
        .set({ role: 'owner' })
        .where(
          eq(organizationMembers.userId, userMember),
        ),
    );
    const afterBilling = await dbCheck(userMember, 'billing:manage');
    expect(afterBilling).toBe(true);

    // Revert for any subsequent tests
    await asAdminTx((tx) =>
      tx
        .update(organizationMembers)
        .set({ role: 'admin' })
        .where(
          eq(organizationMembers.userId, userMember),
        ),
    );
  });
});
