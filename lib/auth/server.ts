import 'server-only';

import { cookies } from 'next/headers';

import { AppError } from '../errors';
import { type Permission } from '../permissions/roles';
import { authorize as authorizePermission } from '../permissions/can';

import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  signSession,
  verifySession,
} from './cookie';
import type { Session } from './types';

/**
 * Auth surface for server code. Server Actions and Route Handlers
 * read `getSession()`; pages that require an account use
 * `requireUser()`. The implementation reads from / writes to the
 * Next.js cookie store — no DB roundtrip per request.
 *
 * In Phase 11 the verification step swaps to Supabase Auth without
 * changing this file's exports. Callers keep working.
 *
 * Marked `server-only` so an accidental client-component import fails
 * at build time instead of bundling secrets into the browser.
 */

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!value) return null;
  return verifySession(value);
}

export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new AppError('UNAUTHORIZED', 'Not signed in.');
  }
  return session;
}

/**
 * Require an authenticated user in a specific organization. Throws if
 * the cookie session is bound to a different org — the UI should call
 * the org-switcher action first to rebind, instead of forcing the
 * wrong org id through.
 */
export async function requireOrg(orgId: string): Promise<Session> {
  const session = await requireUser();
  if (session.orgId !== orgId) {
    throw new AppError('FORBIDDEN', 'Session is bound to a different organization.', {
      meta: { sessionOrg: session.orgId, requestedOrg: orgId },
    });
  }
  return session;
}

/**
 * Require the current user holds `permission` inside their current
 * org. Convenience for the common "auth + RBAC" preamble at the top
 * of Server Actions:
 *
 *   const session = await requirePermission('inbox:reply');
 *   await dbAs({ orgId: session.orgId, userId: session.userId }, ...);
 */
export async function requirePermission(permission: Permission): Promise<Session> {
  const session = await requireUser();
  authorizePermission(session.role, permission);
  return session;
}

/**
 * Issue a fresh cookie. Used by the dev impersonation flow (`./dev.ts`)
 * and, in Phase 11, by the Supabase Auth callback once GoTrue confirms
 * the magic link.
 */
export async function setSession(session: Session): Promise<void> {
  const token = await signSession(session);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
