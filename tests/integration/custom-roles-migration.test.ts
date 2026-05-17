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
import { getMemberWithCustomRoleWithTx } from '../../lib/custom-roles/queries';
import { resolvePermissions } from '../../lib/custom-roles/resolve';
import { seedRolePermissions } from '../../lib/db/seed-role-permissions';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 10 / Commit 36a — lifecycle / session integration
 * (2 cases).
 *
 * Coverage:
 *   #16 custom_role_assignment_resolves_immediately_after_db_change
 *   #17 custom_role_lifecycle_archive_then_reactivate
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3602c3602c0';
const orgId = '11111111-1111-4111-8111-c3602c3602c0';
const userMember = '22222222-2222-4222-8222-c3602c3602c0';
const customRoleId = '88888888-8888-4888-8888-c3602c3602c0';

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
      id: userMember,
      email: 'm@c3602.test',
      name: 'Member',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Lifecycle Org',
      slug: 'c3602-life',
      planId,
    });
    await tx.insert(organizationMembers).values({
      organizationId: orgId,
      userId: userMember,
      role: 'manager',
      status: 'active',
    });
    await tx.insert(customRoles).values({
      id: customRoleId,
      organizationId: orgId,
      name: 'Restricted Manager',
      baseRole: 'manager',
      grants: [],
      revokes: ['posts:delete'], // manager normally has this
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

describe('lifecycle integration', () => {
  it('#16 assignment resolves immediately — getMemberWithCustomRole reflects state', async () => {
    // Before assignment
    const before = await asAdminTx((tx) =>
      getMemberWithCustomRoleWithTx(tx, orgId, userMember),
    );
    expect(before).not.toBeNull();
    expect(before!.customRoleId).toBeNull();
    expect(before!.customRole).toBeNull();
    // TS resolution → manager has posts:delete
    const beforeResolution = resolvePermissions(before!.role, null);
    expect(beforeResolution.effective.has('posts:delete')).toBe(true);

    // Assign the restricted role
    await asAdminTx((tx) =>
      tx
        .update(organizationMembers)
        .set({ customRoleId })
        .where(
          eq(organizationMembers.userId, userMember),
        ),
    );

    // After assignment — same query returns the resolved overlay
    const after = await asAdminTx((tx) =>
      getMemberWithCustomRoleWithTx(tx, orgId, userMember),
    );
    expect(after).not.toBeNull();
    expect(after!.customRoleId).toBe(customRoleId);
    expect(after!.customRole).not.toBeNull();
    expect(after!.customRole!.name).toBe('Restricted Manager');
    expect(after!.customRole!.revokes).toContain('posts:delete');
    // TS resolution now removes posts:delete
    const afterResolution = resolvePermissions(after!.role, {
      baseRole: 'manager',
      grants: [],
      revokes: ['posts:delete'],
    });
    expect(afterResolution.effective.has('posts:delete')).toBe(false);
  });

  it('#17 custom_role lifecycle: archive then reactivate restores resolution', async () => {
    // Archive the custom role
    await asAdminTx((tx) =>
      tx
        .update(customRoles)
        .set({ status: 'archived', archivedAt: new Date() })
        .where(eq(customRoles.id, customRoleId)),
    );
    // The member still has custom_role_id set, but the DB function
    // falls back to default member role because status='archived'.
    const archivedCheck = asRows<{ ok: boolean }>(
      await asAdminTx((tx) =>
        tx.execute(
          sql`SELECT app_permission_check(${userMember}::uuid, ${orgId}::uuid, 'posts:delete') AS ok`,
        ),
      ),
    );
    // Fallback to manager default → posts:delete granted again
    expect(archivedCheck[0]!.ok).toBe(true);

    // Reactivate the role
    await asAdminTx((tx) =>
      tx
        .update(customRoles)
        .set({ status: 'active', archivedAt: null })
        .where(eq(customRoles.id, customRoleId)),
    );
    const reactivatedCheck = asRows<{ ok: boolean }>(
      await asAdminTx((tx) =>
        tx.execute(
          sql`SELECT app_permission_check(${userMember}::uuid, ${orgId}::uuid, 'posts:delete') AS ok`,
        ),
      ),
    );
    // Revoke comes back into effect
    expect(reactivatedCheck[0]!.ok).toBe(false);
  });
});
