import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  customRoles,
  organizationMembers,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { countCustomRolesByOrgWithTx } from '../../lib/custom-roles/queries';
import { seedRolePermissions } from '../../lib/db/seed-role-permissions';
import { getPlan } from '../../lib/plans/plans';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 10 / Commit 36b — cap enforcement helper.
 *
 * The Server Action createCustomRoleAction uses
 * `countCustomRolesByOrg` + `getPlan(plan).limits.maxCustomRoles`
 * to enforce the cap. These tests verify:
 *
 *   - Enterprise = 25 cap (configurable via PlanLimits).
 *   - Standard / Growth = 0 cap (feature itself blocked by bool gate).
 *   - Helper count is correct as roles are added.
 */

let fixture: TestDb;

const enterprisePlanId = '00000000-0000-4000-8000-c3610c3610c0';
const orgId = '11111111-1111-4111-8111-c3610c3610c0';
const userOwner = '22222222-2222-4222-8222-c3610c3610c0';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await seedRolePermissions(tx);
    await tx.insert(plans).values({
      id: enterprisePlanId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({
      id: userOwner,
      email: 'o@c3610.test',
      name: 'Owner',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Cap Org',
      slug: 'c3610-cap',
      planId: enterprisePlanId,
    });
    await tx.insert(organizationMembers).values({
      organizationId: orgId,
      userId: userOwner,
      role: 'owner',
      status: 'active',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const asAdminTx = <T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> =>
  runAdmin(fixture.db, fn);

describe('Plan limits — maxCustomRoles', () => {
  it('Enterprise plan exposes 25 as cap (configurable for future Enterprise Plus)', () => {
    const plan = getPlan('enterprise');
    expect(plan.limits.maxCustomRoles).toBe(25);
  });

  it('Standard and Growth plans cap at 0 (feature-blocked by bool gate)', () => {
    expect(getPlan('standard').limits.maxCustomRoles).toBe(0);
    expect(getPlan('growth').limits.maxCustomRoles).toBe(0);
  });

  it('countCustomRolesByOrg returns 0 → N as roles are created', async () => {
    const before = await asAdminTx((tx) =>
      countCustomRolesByOrgWithTx(tx, orgId, 'active'),
    );
    expect(before).toBe(0);
    for (let i = 0; i < 5; i += 1) {
      await asAdminTx((tx) =>
        tx.insert(customRoles).values({
          organizationId: orgId,
          name: `Cap role ${i}`,
          baseRole: 'manager',
          grants: [],
          revokes: [],
        }),
      );
    }
    const after = await asAdminTx((tx) =>
      countCustomRolesByOrgWithTx(tx, orgId, 'active'),
    );
    expect(after).toBe(5);
  });
});
