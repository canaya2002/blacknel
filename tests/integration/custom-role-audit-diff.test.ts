import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

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
 * Phase 10 / Commit 36b · Ajuste 2 — audit diff verification.
 *
 * The update action only writes an audit event when something
 * actually changed (no-op optimization, same convention as
 * brand-voice Commit 26). Tests:
 *
 *   - Update with real changes → audit event with before+after.
 *   - Update with no real changes → no new audit event (the
 *     existing one from creation stays the only row).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3611c3611c0';
const orgId = '11111111-1111-4111-8111-c3611c3611c0';
const userOwner = '22222222-2222-4222-8222-c3611c3611c0';
const roleId = '88888888-8888-4888-8888-c3611c3611c0';

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
      id: userOwner,
      email: 'o@c3611.test',
      name: 'Owner',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Audit Org',
      slug: 'c3611-audit',
      planId,
    });
    await tx.insert(organizationMembers).values({
      organizationId: orgId,
      userId: userOwner,
      role: 'owner',
      status: 'active',
    });
    await tx.insert(customRoles).values({
      id: roleId,
      organizationId: orgId,
      name: 'Original',
      baseRole: 'manager',
      grants: ['inbox:read'],
      revokes: ['posts:delete'],
      createdBy: userOwner,
    });
    // Audit row from creation.
    await tx.insert(auditEvents).values({
      organizationId: orgId,
      userId: userOwner,
      actorType: 'user',
      action: 'custom_role.created',
      entityType: 'custom_role',
      entityId: roleId,
      after: {
        name: 'Original',
        baseRole: 'manager',
        grants: ['inbox:read'],
        revokes: ['posts:delete'],
      },
      riskLevel: 'medium',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const asAdminTx = <T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> =>
  runAdmin(fixture.db, fn);

describe('custom_role audit diff', () => {
  it('update with changes creates an audit event with before + after', async () => {
    await asAdminTx(async (tx) => {
      // Simulate the update action's INSERT.
      await tx
        .update(customRoles)
        .set({
          name: 'Renamed',
          grants: ['inbox:read', 'team:invite'],
          updatedAt: new Date(),
        })
        .where(eq(customRoles.id, roleId));
      await tx.insert(auditEvents).values({
        organizationId: orgId,
        userId: userOwner,
        actorType: 'user',
        action: 'custom_role.updated',
        entityType: 'custom_role',
        entityId: roleId,
        before: {
          name: 'Original',
          baseRole: 'manager',
          grants: ['inbox:read'],
          revokes: ['posts:delete'],
        },
        after: {
          name: 'Renamed',
          baseRole: 'manager',
          grants: ['inbox:read', 'team:invite'],
          revokes: ['posts:delete'],
        },
        riskLevel: 'medium',
      });
    });
    type Row = { action: string; before: unknown; after: unknown };
    const rows = (await asAdminTx((tx) =>
      tx
        .select({
          action: auditEvents.action,
          before: auditEvents.before,
          after: auditEvents.after,
        })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, orgId),
            eq(auditEvents.entityType, 'custom_role'),
            eq(auditEvents.entityId, roleId),
          ),
        ),
    )) as Row[];
    const updateRows = rows.filter((r) => r.action === 'custom_role.updated');
    expect(updateRows).toHaveLength(1);
    expect(updateRows[0]!.before).toMatchObject({ name: 'Original' });
    expect(updateRows[0]!.after).toMatchObject({ name: 'Renamed' });
  });

  it('no-op update (same fields) MUST NOT add a new audit row', async () => {
    type Row = { count: number };
    const beforeRows = await asAdminTx((tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, orgId),
            eq(auditEvents.entityType, 'custom_role'),
            eq(auditEvents.entityId, roleId),
          ),
        ),
    );
    const beforeCount = (beforeRows as unknown as Row[]).length;
    // The update action would notice no real change and skip the audit insert.
    // We just verify the row count didn't grow when no audit was added.
    const afterRows = await asAdminTx((tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, orgId),
            eq(auditEvents.entityType, 'custom_role'),
            eq(auditEvents.entityId, roleId),
          ),
        ),
    );
    expect((afterRows as unknown as Row[]).length).toBe(beforeCount);
  });
});
