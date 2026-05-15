import 'server-only';

import { AppError } from '../errors';
import { env } from '../env';
import { log } from '../log';

import { setSession, clearSession } from './server';
import type { Session } from './types';

/**
 * Dev-only impersonation. The login page in Commit 4 lists the seeded
 * users and POSTs to a Server Action that calls `loginAsDevUser()`.
 *
 * Aborts loudly outside of development to defend against a misconfigured
 * deployment shipping the dev login UI by accident.
 *
 * Phase 11 retires this function. Real magic-link authentication via
 * Supabase Auth replaces it; the same `setSession()` primitive is
 * called from the auth callback handler.
 */
export async function loginAsDevUser(session: Session): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new AppError(
      'FORBIDDEN',
      'Dev impersonation is not available in production.',
    );
  }
  log.warn({ userId: session.userId, orgId: session.orgId, role: session.role }, 'auth.dev.login');
  await setSession(session);
}

export async function logoutDevUser(): Promise<void> {
  log.info('auth.dev.logout');
  await clearSession();
}
