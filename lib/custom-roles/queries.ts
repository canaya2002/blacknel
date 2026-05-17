import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import {
  customRoles,
  organizationMembers,
  type CustomRole,
} from '@/lib/db/schema';

/**
 * Custom-roles read layer (Phase 10 / Commit 36a).
 *
 * All RLS-bound — every entry point goes through `dbAs` so rows
 * are tenant-scoped to the caller's org. The `countCustomRolesByOrg`
 * helper is consumed by `createCustomRoleAction` (lands in C36b)
 * to enforce `PlanLimits.maxCustomRoles`.
 */

export interface CustomRoleRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly baseRole: CustomRole['baseRole'];
  readonly grants: ReadonlyArray<string>;
  readonly revokes: ReadonlyArray<string>;
  readonly status: CustomRole['status'];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
  readonly memberCount: number;
}

export async function listCustomRolesWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<CustomRoleRow[]> {
  const rows: Array<{
    role: CustomRole;
    memberCount: number;
  }> = await tx
    .select({
      role: customRoles,
      memberCount: sql<number>`COALESCE((
        SELECT COUNT(*)::int FROM ${organizationMembers}
        WHERE ${organizationMembers}.custom_role_id = ${customRoles}.id
      ), 0)`,
    })
    .from(customRoles)
    .where(eq(customRoles.organizationId, orgId))
    .orderBy(desc(customRoles.createdAt));
  return rows.map((r) => mapRow(r.role, r.memberCount));
}

export async function listCustomRoles(ctx: {
  orgId: string;
  userId: string;
}): Promise<CustomRoleRow[]> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    listCustomRolesWithTx(tx, ctx.orgId),
  );
}

export async function getCustomRoleByIdWithTx(
  tx: AnyPgTx,
  orgId: string,
  id: string,
): Promise<CustomRoleRow | null> {
  const rows: Array<{ role: CustomRole; memberCount: number }> = await tx
    .select({
      role: customRoles,
      memberCount: sql<number>`COALESCE((
        SELECT COUNT(*)::int FROM ${organizationMembers}
        WHERE ${organizationMembers}.custom_role_id = ${customRoles}.id
      ), 0)`,
    })
    .from(customRoles)
    .where(
      and(eq(customRoles.organizationId, orgId), eq(customRoles.id, id)),
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return mapRow(r.role, r.memberCount);
}

function mapRow(r: CustomRole, memberCount: number): CustomRoleRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    baseRole: r.baseRole,
    grants: r.grants,
    revokes: r.revokes,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    archivedAt: r.archivedAt,
    memberCount,
  };
}

/**
 * Count active custom roles for a given org. Used by
 * `createCustomRoleAction` (C36b) to enforce the
 * `PlanLimits.maxCustomRoles` cap before insert.
 *
 * Test #11 (`tests/integration/custom-roles-rbac.test.ts`) covers
 * the helper's correctness; C36b adds a separate Server-Action
 * level test for the cap-enforcement integration.
 */
export async function countCustomRolesByOrgWithTx(
  tx: AnyPgTx,
  orgId: string,
  status: 'active' | 'archived' | 'all' = 'active',
): Promise<number> {
  const conds = [eq(customRoles.organizationId, orgId)];
  if (status !== 'all') {
    conds.push(eq(customRoles.status, status));
  }
  const rows: Array<{ count: number }> = await tx
    .select({
      count: sql<number>`COUNT(*)::int`,
    })
    .from(customRoles)
    .where(and(...conds));
  return rows[0]?.count ?? 0;
}

export async function countCustomRolesByOrg(ctx: {
  orgId: string;
  userId: string;
  status?: 'active' | 'archived' | 'all';
}): Promise<number> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    countCustomRolesByOrgWithTx(tx, ctx.orgId, ctx.status ?? 'active'),
  );
}

/**
 * Load a member's resolution context — the default `role` plus
 * (optionally) the joined `custom_roles` row. Returns null if the
 * member doesn't exist or is not active.
 */
export interface MemberResolutionContext {
  readonly memberId: string;
  readonly userId: string;
  readonly role: CustomRole['baseRole'];
  readonly customRoleId: string | null;
  readonly customRole: CustomRole | null;
}

export async function getMemberWithCustomRoleWithTx(
  tx: AnyPgTx,
  orgId: string,
  userId: string,
): Promise<MemberResolutionContext | null> {
  const rows: Array<{
    memberId: string;
    userId: string;
    role: CustomRole['baseRole'];
    customRoleId: string | null;
    customRole: CustomRole | null;
  }> = await tx
    .select({
      memberId: organizationMembers.id,
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      customRoleId: organizationMembers.customRoleId,
      customRole: customRoles,
    })
    .from(organizationMembers)
    .leftJoin(
      customRoles,
      eq(customRoles.id, organizationMembers.customRoleId),
    )
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    memberId: r.memberId,
    userId: r.userId,
    role: r.role,
    customRoleId: r.customRoleId,
    customRole: r.customRole,
  };
}
