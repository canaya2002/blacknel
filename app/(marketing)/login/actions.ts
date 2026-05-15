'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { loginAsDevUser } from '@/lib/auth/dev';
import { dbAdmin } from '@/lib/db/client';
import { organizationMembers, users as usersTable } from '@/lib/db/schema';
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
