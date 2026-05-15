'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { NO_ORG_SENTINEL } from '@/lib/auth/constants';
import { loginAsDevUser } from '@/lib/auth/dev';
import { dbAdmin } from '@/lib/db/client';
import { organizationMembers, users as usersTable } from '@/lib/db/schema';
import { clearOnboardingState } from '@/lib/onboarding/state';
import type { Role } from '@/lib/permissions/roles';

const inputSchema = z.object({
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
});

/**
 * Dev impersonation entry point. Reads (userId, orgId), confirms the
 * user is a member with a real role, signs the session cookie, and
 * sends the browser to /dashboard.
 *
 * Refuses in production via `loginAsDevUser`.
 */
export async function devLoginAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ error: string } | void> {
  const parsed = inputSchema.safeParse({
    userId: formData.get('userId'),
    orgId: formData.get('orgId'),
  });
  if (!parsed.success) {
    return { error: 'Selecciona un usuario válido para continuar.' };
  }

  const { userId, orgId } = parsed.data;

  const rows = await dbAdmin<
    Array<{ role: Role; email: string; name: string | null }>
  >(async (tx) =>
    tx
      .select({
        role: organizationMembers.role,
        email: usersTable.email,
        name: usersTable.name,
      })
      .from(organizationMembers)
      .innerJoin(usersTable, eq(usersTable.id, organizationMembers.userId))
      .where(eq(organizationMembers.userId, userId))
      .limit(1),
  );

  const membership = rows[0];
  if (!membership) {
    return {
      error: 'Ese usuario no pertenece a ninguna organización del seed.',
    };
  }

  await loginAsDevUser({
    userId,
    orgId,
    role: membership.role,
    email: membership.email,
    ...(membership.name ? { name: membership.name } : {}),
  });

  redirect('/dashboard');
}

/**
 * Fresh-account flow. Creates a new public.users row with no membership
 * and signs the session cookie pointing at the NO_ORG sentinel; the
 * (app) layout will then redirect to /onboarding/start.
 *
 * The role on the cookie is 'viewer' as a harmless default — onboarding
 * doesn't check roles, and the cookie is rewritten with the correct
 * role once the user finishes the organization step.
 */
export async function startFreshAccountAction(): Promise<void> {
  const timestamp = Date.now();
  const email = `fresh-${timestamp}@blacknel.test`;

  const created = await dbAdmin<Array<{ id: string }>>(async (tx) =>
    tx
      .insert(usersTable)
      .values({
        id: crypto.randomUUID(),
        email,
        name: 'Nuevo usuario',
      })
      .returning({ id: usersTable.id }),
  );
  const row = created[0];
  if (!row) throw new Error('Failed to create fresh user row.');

  await clearOnboardingState();
  await loginAsDevUser({
    userId: row.id,
    orgId: NO_ORG_SENTINEL,
    role: 'viewer',
    email,
    name: 'Nuevo usuario',
  });

  redirect('/onboarding/start');
}
