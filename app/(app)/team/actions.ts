'use server';

import { and, eq, gt, ne, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { invitations, organizationMembers } from '@/lib/db/schema';
import { sendEmail } from '@/lib/emails/send';
import { env } from '@/lib/env';
import {
  generateInvitationToken,
  invitationAcceptUrl,
  INVITATION_TTL_MS,
} from '@/lib/invitations/tokens';
import { checkUsage, decrementUsage, incrementUsage } from '@/lib/usage/counters';
import { authorize } from '@/lib/permissions/can';
import type { Role } from '@/lib/permissions/roles';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Team management Server Actions: invite, change role, remove. The
 * "send email" piece is delegated to `lib/emails/send.ts` which writes
 * to the dev outbox today and swaps to Resend in Phase 11 — the
 * invitation token + DB row are real either way.
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

  // Plan limit: pending invitations + active members must fit under the
  // users cap. Each accepted invite consumes one user slot, so we count
  // each pending invite as a +1 on usage.
  const usage = await dbAdmin(async (tx) =>
    checkUsage(tx, session.orgId, planCode, 'users', invites.length),
  );
  if (!usage.ok) {
    return err(
      'PLAN_LIMIT_REACHED',
      `Tu plan permite ${usage.cap} usuario(s) y ya tienes ${usage.current}. Sube de plan o cancela una invitación pendiente.`,
      { meta: { plan: planCode, cap: usage.cap, current: usage.current, delta: invites.length } },
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

  let inserted = 0;
  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) => {
      for (const invite of parsed.data.invites) {
        const token = generateInvitationToken();
        await tx
          .insert(invitations)
          .values({
            organizationId: session.orgId,
            email: invite.email,
            role: invite.role,
            token,
            expiresAt,
            invitedBy: session.userId,
          });
        inserted += 1;

        // Dev outbox — link is also shown in the UI so reviewers don't
        // have to fish through logs.
        const link = invitationAcceptUrl(env.NEXT_PUBLIC_APP_URL, token);
        await sendEmail({
          kind: 'invite',
          to: invite.email,
          subject: `Te invitaron a Blacknel`,
          text:
            `Te invitaron a unirte como ${invite.role}.\n\n` +
            `Acepta la invitación: ${link}\n\n` +
            `El enlace caduca el ${expiresAt.toISOString()}.`,
          meta: { orgId: session.orgId, role: invite.role, token, link },
        });
      }
    },
  );

  // Bump the usage counter — pending invitations count against the users cap.
  await dbAdmin(async (tx) =>
    incrementUsage(tx, session.orgId, 'users', inserted),
  );

  revalidatePath('/team');

  const pendingTotal = await dbAs<Array<{ n: number }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({ n: countCol() })
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, session.orgId),
            gt(invitations.expiresAt, now),
          ),
        ),
  ).then((r) => r[0]?.n ?? 0);

  return ok({ count: inserted, pendingTotal });
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
