'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { NO_ORG_SENTINEL } from '@/lib/auth/constants';
import { loginAsDevUser } from '@/lib/auth/dev';
import { createSupabaseServerClient } from '@/lib/auth/supabase-server';
import { dbAdmin } from '@/lib/db/client';
import { organizationMembers, users as usersTable } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
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
 *
 * # Phase 11 / C42a behavior under flag=real
 *
 * Under `BLACKNEL_USE_REAL_AUTH=true` this action becomes unreachable
 * (the /login page renders the magic-link form instead of the fresh-
 * account button). The guard below is belt-and-suspenders: if somebody
 * fires the action directly, refuse rather than silently fabricate a
 * row that Supabase Auth has no record of.
 */
export async function startFreshAccountAction(): Promise<void> {
  if (env.BLACKNEL_USE_REAL_AUTH) {
    throw new Error(
      'Fresh-account fabrication is disabled under BLACKNEL_USE_REAL_AUTH=true. ' +
        'Use the magic-link sign-up flow at /login.',
    );
  }

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

// ---------------------------------------------------------------------------
// Phase 11 / Commit 42a — magic-link sign-in (BLACKNEL_USE_REAL_AUTH=true)
// ---------------------------------------------------------------------------

const magicLinkInputSchema = z.object({
  email: z.string().email().max(254),
  // `next` is a relative app path (e.g. `/dashboard`, `/inbox/42`). Validated
  // here so we don't pass an absolute URL to Supabase's emailRedirectTo —
  // that would allow open-redirect into a third-party domain.
  next: z
    .string()
    .max(512)
    .optional()
    .transform((v) => (v && v.startsWith('/') && !v.startsWith('//') ? v : '/dashboard')),
});

/**
 * Send a magic-link email via Supabase Auth. The `emailRedirectTo` URL
 * points at our local `/auth/callback` route which exchanges the code
 * for a session and redirects on into `next`.
 *
 * Refuses to run when `BLACKNEL_USE_REAL_AUTH=false` — the dev flow uses
 * `devLoginAction` above. The two are intentionally separate so the
 * mock UI never accidentally invokes Supabase under flag=mock.
 */
export async function sendMagicLinkAction(
  formData: FormData,
): Promise<{ sent?: boolean; email?: string; error?: string }> {
  if (!env.BLACKNEL_USE_REAL_AUTH) {
    return {
      error:
        'El flujo de magic link requiere BLACKNEL_USE_REAL_AUTH=true. Usa la lista de cuentas seed.',
    };
  }

  const parsed = magicLinkInputSchema.safeParse({
    email: formData.get('email'),
    next: formData.get('next') ?? undefined,
  });
  if (!parsed.success) {
    return { error: 'Ingresa un correo válido.' };
  }

  const { email, next } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const callbackUrl = new URL('/auth/callback', env.NEXT_PUBLIC_APP_URL);
  callbackUrl.searchParams.set('next', next);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callbackUrl.toString(),
      // shouldCreateUser=false would block first-time logins; we explicitly
      // ALLOW creation here because Phase 11 onboarding starts at magic
      // link (no separate sign-up flow). The Custom Access Token Hook
      // emits a null org_id for first-timers; the (app) layout routes
      // them to /onboarding/start automatically.
      shouldCreateUser: true,
    },
  });

  if (error) {
    log.warn({ err: error, email }, 'auth.magic_link.send_failed');
    return {
      error:
        'No pudimos enviar el correo en este momento. Intenta de nuevo en unos minutos.',
    };
  }

  log.info({ email }, 'auth.magic_link.sent');
  return { sent: true, email };
}
