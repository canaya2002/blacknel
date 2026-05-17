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
import { seedRolePermissions } from '../../lib/db/seed-role-permissions';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 10 / Commit 36b · Ajuste 3 — dual-enforcement bypass tests.
 *
 * For each of the 5 critical actions (create / update / archive /
 * assign / change-default-role), verify that the DB function
 * `app_permission_check` blocks even when the TS layer would
 * allow.
 *
 * Strategy: assign the member a custom role with REVOKE on
 * `team:manage_roles`. TS `authorize(session.role, 'team:manage_roles')`
 * still passes (session.role = admin, which has the perm). But
 * `app_permission_check` resolves with the overlay and returns
 * false. Each test queries `app_permission_check` directly with
 * the synthetic session — same primitive every Server Action
 * uses through `assertPermissionInDb`.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3612c3612c0';
const orgId = '11111111-1111-4111-8111-c3612c3612c0';
const userAdmin = '22222222-2222-4222-8222-c3612c3612c0';
const restrictedRoleId = '88888888-8888-4888-8888-c3612c3612c0';

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
    await tx.insert(users).values({
      id: userAdmin,
      email: 'a@c3612.test',
      name: 'Admin',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Dual Org',
      slug: 'c3612-dual',
      planId,
    });
    // Admin member assigned to a custom_role that revokes
    // team:manage_roles. TS authorize() passes; DB resolves false.
    await tx.insert(customRoles).values({
      id: restrictedRoleId,
      organizationId: orgId,
      name: 'No role mgmt',
      baseRole: 'admin',
      grants: [],
      revokes: ['team:manage_roles'],
    });
    await tx.insert(organizationMembers).values({
      organizationId: orgId,
      userId: userAdmin,
      role: 'admin',
      customRoleId: restrictedRoleId,
      status: 'active',
    });
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

async function dbCheck(permission: string): Promise<boolean> {
  const rows = asRows<{ ok: boolean }>(
    await asAdminTx((tx) =>
      tx.execute(
        sql`SELECT app_permission_check(${userAdmin}::uuid, ${orgId}::uuid, ${permission}) AS ok`,
      ),
    ),
  );
  return rows[0]?.ok === true;
}

describe('Dual enforcement — 5 critical actions blocked despite TS-admin', () => {
  it('createCustomRoleAction path: TS admin has team:manage_roles → DB blocks via revoke', async () => {
    // TS layer simulation: admin role.permissions includes
    // team:manage_roles (verifiable by importing ROLE_PERMISSIONS).
    // DB layer: dbCheck returns false because custom_role revoked it.
    expect(await dbCheck('team:manage_roles')).toBe(false);
  });

  it('updateCustomRoleAction path: same — DB blocks', async () => {
    // Same permission. The Server Action for update calls
    // assertPermissionInDb('team:manage_roles') — would throw FORBIDDEN.
    expect(await dbCheck('team:manage_roles')).toBe(false);
  });

  it('archiveCustomRoleAction path: same — DB blocks', async () => {
    expect(await dbCheck('team:manage_roles')).toBe(false);
  });

  it('assignCustomRoleAction path: DB blocks even with admin TS', async () => {
    // The action checks team:manage_roles which is revoked.
    expect(await dbCheck('team:manage_roles')).toBe(false);
  });

  it('changeMemberRoleAction path: DB blocks even with admin TS', async () => {
    expect(await dbCheck('team:manage_roles')).toBe(false);
  });

  it('control: removing the revoke restores DB permission immediately', async () => {
    await asAdminTx((tx) =>
      tx
        .update(customRoles)
        .set({ revokes: [] })
        .where(eq(customRoles.id, restrictedRoleId)),
    );
    expect(await dbCheck('team:manage_roles')).toBe(true);
  });
});
