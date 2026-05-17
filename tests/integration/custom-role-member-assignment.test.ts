import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  auditEvents,
  customRoles,
  organizationMembers,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { seedRolePermissions } from '../../lib/db/seed-role-permissions';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 10 / Commit 36b — member ↔ custom_role assignment
 * lifecycle at the DB layer.
 *
 *   - Assignment writes `custom_role_id` + emits audit event with
 *     before+after.
 *   - Unassignment (set to null) writes another audit event.
 *   - Switching from role A to role B captures the transition.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3613c3613c0';
const orgId = '11111111-1111-4111-8111-c3613c3613c0';
const userOwner = '22222222-2222-4222-8222-c3613c3613c0';
const userMember = '22222222-2222-4222-8222-c3613c3613c1';
const memberId = 'aaaaaaaa-aaaa-4aaa-8aaa-c3613c3613c0';
const roleA = '88888888-8888-4888-8888-c3613c3613c0';
const roleB = '88888888-8888-4888-8888-c3613c3613c1';

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
      { id: userOwner, email: 'o@c3613.test', name: 'Owner' },
      { id: userMember, email: 'm@c3613.test', name: 'Member' },
    ]);
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Assign Org',
      slug: 'c3613-assign',
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
        id: memberId,
        organizationId: orgId,
        userId: userMember,
        role: 'manager',
        status: 'active',
      },
    ]);
    await tx.insert(customRoles).values([
      {
        id: roleA,
        organizationId: orgId,
        name: 'Role A',
        baseRole: 'manager',
        grants: ['team:invite'],
        revokes: [],
        createdBy: userOwner,
      },
      {
        id: roleB,
        organizationId: orgId,
        name: 'Role B',
        baseRole: 'admin',
        grants: [],
        revokes: ['billing:read'],
        createdBy: userOwner,
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const asAdminTx = <T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> =>
  runAdmin(fixture.db, fn);

describe('member ↔ custom_role assignment', () => {
  it('assignment populates custom_role_id + writes audit', async () => {
    await asAdminTx(async (tx) => {
      await tx
        .update(organizationMembers)
        .set({ customRoleId: roleA, updatedAt: new Date() })
        .where(eq(organizationMembers.id, memberId));
      await tx.insert(auditEvents).values({
        organizationId: orgId,
        userId: userOwner,
        actorType: 'user',
        action: 'custom_role.assigned',
        entityType: 'organization_member',
        entityId: memberId,
        before: { customRoleId: null },
        after: { customRoleId: roleA },
        riskLevel: 'high',
      });
    });
    type Row = { customRoleId: string | null };
    const rows = (await asAdminTx((tx) =>
      tx
        .select({
          customRoleId: organizationMembers.customRoleId,
        })
        .from(organizationMembers)
        .where(eq(organizationMembers.id, memberId)),
    )) as Row[];
    expect(rows[0]!.customRoleId).toBe(roleA);
  });

  it('switch A → B captures transition in audit', async () => {
    await asAdminTx(async (tx) => {
      await tx
        .update(organizationMembers)
        .set({ customRoleId: roleB, updatedAt: new Date() })
        .where(eq(organizationMembers.id, memberId));
      await tx.insert(auditEvents).values({
        organizationId: orgId,
        userId: userOwner,
        actorType: 'user',
        action: 'custom_role.assigned',
        entityType: 'organization_member',
        entityId: memberId,
        before: { customRoleId: roleA },
        after: { customRoleId: roleB },
        riskLevel: 'high',
      });
    });
    type Row = { before: unknown; after: unknown };
    const audits = (await asAdminTx((tx) =>
      tx
        .select({
          before: auditEvents.before,
          after: auditEvents.after,
        })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, memberId)),
    )) as Row[];
    const switchEvt = audits.find(
      (a) =>
        (a.before as { customRoleId?: string } | null)?.customRoleId === roleA,
    );
    expect(switchEvt).toBeDefined();
    expect((switchEvt!.after as { customRoleId: string }).customRoleId).toBe(
      roleB,
    );
  });

  it('unassignment (set to null) writes audit + clears column', async () => {
    await asAdminTx(async (tx) => {
      await tx
        .update(organizationMembers)
        .set({ customRoleId: null, updatedAt: new Date() })
        .where(eq(organizationMembers.id, memberId));
      await tx.insert(auditEvents).values({
        organizationId: orgId,
        userId: userOwner,
        actorType: 'user',
        action: 'custom_role.assigned',
        entityType: 'organization_member',
        entityId: memberId,
        before: { customRoleId: roleB },
        after: { customRoleId: null },
        riskLevel: 'high',
      });
    });
    type Row = { customRoleId: string | null };
    const rows = (await asAdminTx((tx) =>
      tx
        .select({ customRoleId: organizationMembers.customRoleId })
        .from(organizationMembers)
        .where(eq(organizationMembers.id, memberId)),
    )) as Row[];
    expect(rows[0]!.customRoleId).toBeNull();
  });
});
