'use server';

import { and, eq, ne, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { invitations, organizationMembers } from '@/lib/db/schema';
import { decrementUsage } from '@/lib/usage/counters';
import { authorize } from '@/lib/permissions/can';
import type { Role } from '@/lib/permissions/roles';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { createInvitations } from '@/lib/team/invite';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Team management Server Actions: invite, change role, remove.
 *
 * The invite path delegates seats-gate + DB rows + transactional email to
 * `lib/team/invite.ts` (`createInvitations`), which sends the typed
 * `team_invite` template via C44 Email (Resend behind a flag, durable retry via
 * the Inngest `email.send` event). The action stays a thin auth + parse +
 * revalidate wrapper.
 */

const inviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(['admin', 'manager', 'agent', 'viewer']),
});

const inviteBatchSchema = z.object({
  invites: z.array(inviteSchema).min(1).max(20),
});

export async function inviteTeamAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ count: number; pendingTotal: number }>> {
  const session = await requireUser();
  authorize(session.role, 'team:invite');

  // The form serialises N invitations as parallel `emails[]` / `roles[]`
  // arrays. We zip them server-side.
  const emails = formData.getAll('emails').map(String).filter(Boolean);
  const roles = formData.getAll('roles').map(String);
  const invites = emails.map((email, i) => ({
    email: email.trim().toLowerCase(),
    role: (roles[i] ?? 'agent') as Role,
  }));
  const parsed = inviteBatchSchema.safeParse({ invites });
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Revisa los correos y roles.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  const planCode = await getOrgPlanCode(session);

  const result = await createInvitations({
    orgId: session.orgId,
    userId: session.userId,
    inviterName: session.name ?? session.email,
    invites: parsed.data.invites,
    planCode,
  });

  if (result.ok) revalidatePath('/team');
  return result;
}

const changeRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'manager', 'agent', 'viewer']),
});

export async function changeRoleAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ userId: string; role: Role }>> {
  const session = await requireUser();
  authorize(session.role, 'team:manage_roles');

  const parsed = changeRoleSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos inválidos.');
  }
  const { userId, role } = parsed.data;

  // Can't demote yourself out of owner if you're the only owner.
  if (userId === session.userId && session.role === 'owner' && role !== 'owner') {
    const ownersLeft = await ownerCount(session.orgId, session.userId, userId);
    if (ownersLeft === 0) {
      return err(
        'CONFLICT',
        'Eres el único owner. Asigna a alguien más como owner antes de cambiar tu propio rol.',
      );
    }
  }

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(organizationMembers)
        .set({ role })
        .where(
          and(
            eq(organizationMembers.organizationId, session.orgId),
            eq(organizationMembers.userId, userId),
          ),
        ),
  );

  revalidatePath('/team');
  return ok({ userId, role });
}

const removeMemberSchema = z.object({
  userId: z.string().uuid(),
});

export async function removeMemberAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ userId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'team:manage_roles');

  const parsed = removeMemberSchema.safeParse({ userId: formData.get('userId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos.');
  const { userId } = parsed.data;

  // Removing the last owner is a hard stop — leaves the org orphaned.
  const targetIsOwner = await dbAs<Array<{ role: Role }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, session.orgId),
            eq(organizationMembers.userId, userId),
          ),
        )
        .limit(1),
  ).then((rows) => rows[0]?.role === 'owner');

  if (targetIsOwner) {
    const ownersLeft = await ownerCount(session.orgId, userId, userId);
    if (ownersLeft === 0) {
      return err(
        'CONFLICT',
        'No puedes remover al único owner. Asigna a alguien más como owner primero.',
      );
    }
  }

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, session.orgId),
            eq(organizationMembers.userId, userId),
          ),
        ),
  );

  await dbAdmin(async (tx) =>
    decrementUsage(tx, session.orgId, 'users', 1),
  );

  revalidatePath('/team');
  return ok({ userId });
}

const cancelInviteSchema = z.object({
  invitationId: z.string().uuid(),
});

export async function cancelInvitationAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ invitationId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'team:invite');

  const parsed = cancelInviteSchema.safeParse({
    invitationId: formData.get('invitationId'),
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos.');

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .delete(invitations)
        .where(
          and(
            eq(invitations.organizationId, session.orgId),
            eq(invitations.id, parsed.data.invitationId),
          ),
        ),
  );

  await dbAdmin(async (tx) => decrementUsage(tx, session.orgId, 'users', 1));

  revalidatePath('/team');
  return ok({ invitationId: parsed.data.invitationId });
}

/** Count of owners in the org, optionally excluding a user about to change. */
async function ownerCount(
  orgId: string,
  excludeUserId: string,
  callerId: string,
): Promise<number> {
  const rows = await dbAs<Array<{ n: number }>>(
    { orgId, userId: callerId },
    async (tx) =>
      tx
        .select({ n: countCol() })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, orgId),
            eq(organizationMembers.role, 'owner'),
            ne(organizationMembers.userId, excludeUserId),
          ),
        ),
  );
  return rows[0]?.n ?? 0;
}

// Local count helper.
function countCol() {
  return sql<number>`cast(count(*) as int)`;
}

/**
 * Thin wrapper for direct `<form action={...}>` usage. Form actions in
 * React 19 / Next 16 expect `(formData) => Promise<void>`; our
 * useActionState-friendly variant takes `(prev, formData) => Result`.
 */
export async function cancelInvitationFormAction(formData: FormData): Promise<void> {
  await cancelInvitationAction(null, formData);
}
