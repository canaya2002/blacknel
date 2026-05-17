'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/server';
import {
  countCustomRolesByOrgWithTx,
} from '@/lib/custom-roles/queries';
import {
  archiveCustomRoleSchema,
  assignCustomRoleSchema,
  changeMemberRoleSchema,
  createCustomRoleSchema,
  updateCustomRoleSchema,
} from '@/lib/custom-roles/validate';
import { dbAdmin, dbAs } from '@/lib/db/client';
import {
  auditEvents,
  customRoles,
  organizationMembers,
  type CustomRole,
  type OrganizationMember,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { assertPermissionInDb } from '@/lib/permissions/db-check';
import { authorize } from '@/lib/permissions/can';
import { requirePlanFeature } from '@/lib/plans/gates';
import { getPlan } from '@/lib/plans/plans';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Custom-roles Server Actions (Phase 10 / Commit 36b).
 *
 * Every action below is one of the **10 critical actions**
 * (`doc/PATTERNS.md#critical-actions-dual-ts--db-enforcement`)
 * and applies dual enforcement: `authorize()` (TS) +
 * `assertPermissionInDb()` (DB cross-check).
 *
 * Order of guards (consistent across actions):
 *   1. `requireUser()` — auth.
 *   2. `authorize(session.role, 'team:manage_roles')` — TS RBAC.
 *   3. `requirePlanFeature(plan, 'custom_roles')` — plan gate.
 *   4. `assertPermissionInDb(session, 'team:manage_roles')` —
 *      DB RBAC cross-check.
 *   5. Zod parse.
 *   6. Body work.
 *   7. Audit.
 */

// ---------------------------------------------------------------------------
// createCustomRoleAction (critical action #10)
// ---------------------------------------------------------------------------

export async function createCustomRoleAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ customRoleId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'team:manage_roles');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'custom_roles');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  try {
    await assertPermissionInDb(session, 'team:manage_roles');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = createCustomRoleSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos del rol inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  // Cap enforcement (D-36a-7). Helper from C36a.
  const cap = getPlan(plan).limits.maxCustomRoles;
  const currentCount = await dbAs<number>(
    { orgId: session.orgId, userId: session.userId },
    (tx) => countCustomRolesByOrgWithTx(tx, session.orgId, 'active'),
  );
  if (cap >= 0 && currentCount >= cap) {
    return err(
      'PLAN_LIMIT_REACHED',
      `Plan ${plan} permite máximo ${cap} custom roles. Tenés ${currentCount}.`,
      { meta: { cap, currentCount, plan } },
    );
  }

  const inserted = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .insert(customRoles)
        .values({
          organizationId: session.orgId,
          name: data.name,
          ...(data.description ? { description: data.description } : {}),
          baseRole: data.baseRole,
          grants: data.grants,
          revokes: data.revokes,
          status: 'active',
          createdBy: session.userId,
        })
        .returning({ id: customRoles.id }),
  );
  const customRoleId = inserted[0]?.id;
  if (!customRoleId) {
    return err('INTERNAL_ERROR', 'No se pudo crear el custom role.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'custom_role.created',
        entityType: 'custom_role',
        entityId: customRoleId,
        after: {
          name: data.name,
          baseRole: data.baseRole,
          grants: data.grants,
          revokes: data.revokes,
        },
        riskLevel: 'medium',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit custom_role.created.',
      { cause, meta: { customRoleId } },
    );
  }

  revalidatePath('/team/roles');
  return ok({ customRoleId });
}

// ---------------------------------------------------------------------------
// updateCustomRoleAction (critical action #10)
// ---------------------------------------------------------------------------

export async function updateCustomRoleAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ customRoleId: string; changed: boolean }>> {
  const session = await requireUser();
  authorize(session.role, 'team:manage_roles');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'custom_roles');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }
  try {
    await assertPermissionInDb(session, 'team:manage_roles');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = updateCustomRoleSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos del rol inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  // Load existing to compute diff + skip no-op audit.
  const existing = await dbAs<CustomRole[]>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select()
        .from(customRoles)
        .where(
          and(
            eq(customRoles.organizationId, session.orgId),
            eq(customRoles.id, data.id),
          ),
        )
        .limit(1),
  );
  const prior = existing[0];
  if (!prior) {
    return err('NOT_FOUND', 'Custom role no encontrado.');
  }

  const changed =
    prior.name !== data.name ||
    (prior.description ?? null) !== (data.description ?? null) ||
    prior.baseRole !== data.baseRole ||
    JSON.stringify(prior.grants) !== JSON.stringify(data.grants) ||
    JSON.stringify(prior.revokes) !== JSON.stringify(data.revokes);

  if (!changed) {
    // No-op: don't write update, don't audit. Same convention as
    // Commit 26 brand-voice updates.
    return ok({ customRoleId: data.id, changed: false });
  }

  await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(customRoles)
      .set({
        name: data.name,
        description: data.description ?? null,
        baseRole: data.baseRole,
        grants: data.grants,
        revokes: data.revokes,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customRoles.organizationId, session.orgId),
          eq(customRoles.id, data.id),
        ),
      ),
  );

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'custom_role.updated',
        entityType: 'custom_role',
        entityId: data.id,
        before: {
          name: prior.name,
          baseRole: prior.baseRole,
          grants: prior.grants,
          revokes: prior.revokes,
        },
        after: {
          name: data.name,
          baseRole: data.baseRole,
          grants: data.grants,
          revokes: data.revokes,
        },
        riskLevel: 'medium',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit custom_role.updated.',
      { cause, meta: { customRoleId: data.id } },
    );
  }

  revalidatePath('/team/roles');
  revalidatePath(`/team/roles/${data.id}`);
  return ok({ customRoleId: data.id, changed: true });
}

// ---------------------------------------------------------------------------
// archiveCustomRoleAction (critical action #10)
// ---------------------------------------------------------------------------

export async function archiveCustomRoleAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ customRoleId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'team:manage_roles');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'custom_roles');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }
  try {
    await assertPermissionInDb(session, 'team:manage_roles');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = archiveCustomRoleSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'customRoleId inválido.');
  }

  const now = new Date();
  const updated = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .update(customRoles)
        .set({ status: 'archived', archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(customRoles.organizationId, session.orgId),
            eq(customRoles.id, parsed.data.customRoleId),
          ),
        )
        .returning({ id: customRoles.id }),
  );
  if (updated.length === 0) {
    return err('NOT_FOUND', 'Custom role no encontrado.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'custom_role.archived',
        entityType: 'custom_role',
        entityId: parsed.data.customRoleId,
        riskLevel: 'medium',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit custom_role.archived.',
      { cause },
    );
  }

  revalidatePath('/team/roles');
  return ok({ customRoleId: parsed.data.customRoleId });
}

// ---------------------------------------------------------------------------
// assignCustomRoleAction (critical action #3)
// ---------------------------------------------------------------------------

export async function assignCustomRoleAction(
  _prev: unknown,
  input: unknown,
): Promise<
  Result<{
    memberId: string;
    customRoleId: string | null;
  }>
> {
  const session = await requireUser();
  authorize(session.role, 'team:manage_roles');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'custom_roles');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }
  try {
    await assertPermissionInDb(session, 'team:manage_roles');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = assignCustomRoleSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Input inválido.');
  }

  const existingMember: OrganizationMember[] = await dbAs(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, session.orgId),
            eq(organizationMembers.id, parsed.data.memberId),
          ),
        )
        .limit(1),
  );
  const member = existingMember[0];
  if (!member) {
    return err('NOT_FOUND', 'Miembro no encontrado.');
  }
  const priorCustomRoleId = member.customRoleId;

  await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(organizationMembers)
      .set({
        customRoleId: parsed.data.customRoleId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationMembers.organizationId, session.orgId),
          eq(organizationMembers.id, parsed.data.memberId),
        ),
      ),
  );

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'custom_role.assigned',
        entityType: 'organization_member',
        entityId: parsed.data.memberId,
        before: { customRoleId: priorCustomRoleId },
        after: { customRoleId: parsed.data.customRoleId },
        riskLevel: 'high',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit custom_role.assigned.',
      { cause },
    );
  }

  revalidatePath('/team');
  revalidatePath('/team/roles');
  return ok({
    memberId: parsed.data.memberId,
    customRoleId: parsed.data.customRoleId,
  });
}

// ---------------------------------------------------------------------------
// changeMemberRoleAction (critical action #4)
// ---------------------------------------------------------------------------

export async function changeMemberRoleAction(
  _prev: unknown,
  input: unknown,
): Promise<
  Result<{
    memberId: string;
    role: 'admin' | 'manager' | 'agent' | 'viewer';
  }>
> {
  const session = await requireUser();
  authorize(session.role, 'team:manage_roles');

  // NOTE: plan gate NOT required here — changing default roles is a
  // Phase-2 capability available on every plan. Only the *custom*
  // role management is Growth/Enterprise-gated.
  try {
    await assertPermissionInDb(session, 'team:manage_roles');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = changeMemberRoleSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Input inválido.');
  }

  const existingMember: OrganizationMember[] = await dbAs(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, session.orgId),
            eq(organizationMembers.id, parsed.data.memberId),
          ),
        )
        .limit(1),
  );
  const member = existingMember[0];
  if (!member) {
    return err('NOT_FOUND', 'Miembro no encontrado.');
  }
  if (member.role === 'owner') {
    return err(
      'FORBIDDEN',
      'No se puede cambiar el rol del owner. Transferí ownership primero.',
    );
  }
  const priorRole = member.role;
  if (priorRole === parsed.data.role) {
    return ok({ memberId: parsed.data.memberId, role: parsed.data.role });
  }

  await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(organizationMembers)
      .set({ role: parsed.data.role, updatedAt: new Date() })
      .where(
        and(
          eq(organizationMembers.organizationId, session.orgId),
          eq(organizationMembers.id, parsed.data.memberId),
        ),
      ),
  );

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'organization_member.role_changed',
        entityType: 'organization_member',
        entityId: parsed.data.memberId,
        before: { role: priorRole },
        after: { role: parsed.data.role },
        riskLevel: 'high',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit organization_member.role_changed.',
      { cause },
    );
  }

  revalidatePath('/team');
  return ok({ memberId: parsed.data.memberId, role: parsed.data.role });
}
