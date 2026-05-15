'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { setSession } from '@/lib/auth/server';
import { dbAdmin } from '@/lib/db/client';
import { invitations, organizationMembers, users } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { decrementUsage } from '@/lib/usage/counters';
import { err, type Result } from '@/lib/types/result';

const inputSchema = z.object({
  token: z.string().min(8).max(512),
  name: z.string().min(1).max(120).optional(),
});

/**
 * Public invitation-acceptance Server Action.
 *
 * In Phase 1–10 we autoprovision a fresh user keyed on the invitation
 * email if no public.users row exists yet, and then sign a session
 * cookie for that user. Phase 11 changes the "autoprovision" branch
 * into a "redirect to Supabase Auth, come back with a real auth.users
 * id"; everything else stays put.
 *
 * Idempotent — accepting twice with the same token simply lands the
 * user in their org dashboard without creating duplicate memberships.
 */
export async function acceptInvitationAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ orgId: string }>> {
  const parsed = inputSchema.safeParse({
    token: formData.get('token'),
    name: formData.get('name') ?? undefined,
  });
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos inválidos.');
  }
  const { token, name } = parsed.data;

  const result = await dbAdmin<
    | { kind: 'ok'; orgId: string; userId: string; email: string; name: string | null; role: 'owner' | 'admin' | 'manager' | 'agent' | 'viewer' }
    | { kind: 'expired' }
    | { kind: 'not_found' }
  >(async (tx) => {
    const invitation = (
      await tx
        .select()
        .from(invitations)
        .where(eq(invitations.token, token))
        .limit(1)
    )[0];

    if (!invitation) return { kind: 'not_found' as const };
    if (invitation.acceptedAt) {
      // Already accepted — find the membership and treat as ok.
    } else if (invitation.expiresAt.getTime() < Date.now()) {
      return { kind: 'expired' as const };
    }

    // Find-or-create the user.
    const existing = (
      await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.email, invitation.email))
        .limit(1)
    )[0];

    let userId: string;
    let userName: string | null;
    if (existing) {
      userId = existing.id;
      userName = existing.name ?? name ?? null;
      if (name && !existing.name) {
        await tx
          .update(users)
          .set({ name })
          .where(eq(users.id, existing.id));
        userName = name;
      }
    } else {
      const inserted = (
        await tx
          .insert(users)
          .values({
            id: crypto.randomUUID(),
            email: invitation.email,
            name: name ?? null,
            defaultOrganizationId: invitation.organizationId,
          })
          .returning({ id: users.id })
      )[0];
      if (!inserted) throw new Error('Failed to create user row for invitation.');
      userId = inserted.id;
      userName = name ?? null;
    }

    // Find-or-create the membership.
    const existingMembership = (
      await tx
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, invitation.organizationId),
            eq(organizationMembers.userId, userId),
          ),
        )
        .limit(1)
    )[0];

    const wasNewMembership = !existingMembership;
    if (wasNewMembership) {
      await tx.insert(organizationMembers).values({
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
        status: 'active',
        invitedBy: invitation.invitedBy ?? null,
        joinedAt: new Date(),
      });
    }

    // Mark the invitation accepted (idempotent for re-clicks).
    if (!invitation.acceptedAt) {
      await tx
        .update(invitations)
        .set({ acceptedAt: new Date(), acceptedBy: userId })
        .where(
          and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt)),
        );
    }

    // Usage counter bookkeeping: pending invite already counted as +1.
    // - New membership from a new invitation → no net change (already
    //   counted when the invite was sent).
    // - User already a member (re-click) → revert the +1 we added at
    //   invite time.
    if (!wasNewMembership) {
      await decrementUsage(tx, invitation.organizationId, 'users', 1);
    }

    return {
      kind: 'ok' as const,
      orgId: invitation.organizationId,
      userId,
      email: invitation.email,
      name: userName,
      role: invitation.role,
    };
  });

  if (result.kind === 'not_found') {
    return err('NOT_FOUND', 'Esta invitación no existe.');
  }
  if (result.kind === 'expired') {
    return err('VALIDATION_ERROR', 'Esta invitación ya caducó. Pide otra a tu admin.');
  }

  await setSession({
    userId: result.userId,
    orgId: result.orgId,
    role: result.role,
    email: result.email,
    ...(result.name ? { name: result.name } : {}),
  });

  log.info(
    { userId: result.userId, orgId: result.orgId, role: result.role },
    'invitation.accepted',
  );

  // Returning ok here would mean the caller has to push to /dashboard
  // themselves; rather than a useEffect dance, redirect server-side.
  // `redirect()` returns `never` — control flow stops here.
  redirect('/dashboard');
}
