import 'server-only';

import { cookies } from 'next/headers';

import { env } from '../env';
import { AppError } from '../errors';
import { type Permission } from '../permissions/roles';
import { authorize as authorizePermission } from '../permissions/can';

import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  signSession,
  verifySession,
} from './cookie';
import { clearSupabaseSession, getSupabaseSession } from './supabase-claims';
import type { Session } from './types';

/**
 * Auth surface for server code. Server Actions and Route Handlers
 * read `getSession()`; pages that require an account use
 * `requireUser()`. The implementation reads from / writes to the
 * Next.js cookie store — no DB roundtrip per request.
 *
 * # Phase 11 / Commit 42a — dual-implementation switch
 *
 * `getSession()` / `setSession()` / `clearSession()` branch on
 * `env.BLACKNEL_USE_REAL_AUTH`:
 *
 *   false (default) → JOSE-signed `blacknel_session` cookie
 *                     (`lib/auth/cookie.ts`). Phase 1-10 behavior.
 *   true            → Supabase Auth via `@supabase/ssr`. Cookies named
 *                     `sb-<project-ref>-auth-token`; custom claims
 *                     (org_id, role, custom_role_id) injected by the
 *                     `add_org_claims` Custom Access Token Hook.
 *
 * The public surface — `getSession`, `requireUser`, `requireOrg`,
 * `requirePermission`, `setSession`, `clearSession` — is intentionally
 * identical across both paths so the ~95 call sites in `app/` and
 * `lib/` do not change.
 *
 * Marked `server-only` so an accidental client-component import fails
 * at build time instead of bundling secrets into the browser.
 */

export async function getSession(): Promise<Session | null> {
  if (env.BLACKNEL_USE_REAL_AUTH) {
    return getSupabaseSession();
  }
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
 * under flag=mock, and by the Supabase Auth callback (`app/auth/callback/route.ts`)
 * under flag=real — though in the Supabase path the cookie write is
 * performed by `@supabase/ssr`'s exchange call, so `setSession` here is
 * a no-op (kept for API parity).
 */
export async function setSession(session: Session): Promise<void> {
  if (env.BLACKNEL_USE_REAL_AUTH) {
    // Supabase cookies are written by @supabase/ssr's exchangeCodeForSession
    // inside the callback route. This is intentional: trying to write a
    // Supabase-format cookie from outside that flow would break the JWT.
    // No-op preserves the call sites that still invoke setSession() (e.g.,
    // onboarding, org-switcher) — they read the live claims on the next
    // request automatically.
    return;
  }
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
  if (env.BLACKNEL_USE_REAL_AUTH) {
    // Sign Supabase out first (best-effort) so the refresh token is
    // invalidated server-side, then drop any Blacknel-side cookies that
    // may still be sitting around from a prior flag=mock session.
    await clearSupabaseSession();
  }
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
