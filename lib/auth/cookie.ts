import { jwtVerify, SignJWT } from 'jose';

import { env } from '../env';
import { log } from '../log';

import type { Session } from './types';

export const SESSION_COOKIE_NAME = 'blacknel_session';
/**
 * Schema version embedded in the JWT. Bump when `Session` changes shape
 * incompatibly so older cookies are rejected on the next request.
 */
export const SESSION_COOKIE_VERSION = 1;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Dev/test placeholder. Stable across restarts so sessions survive
 * `pnpm dev` reloads. Production MUST set BLACKNEL_COOKIE_SECRET — the
 * guard below throws on `NODE_ENV=production` if the variable is missing.
 *
 * Long enough to satisfy HS256's minimum key length comfortably.
 */
const DEV_SECRET_FALLBACK =
  'blacknel-dev-placeholder-cookie-secret-do-not-use-in-prod-1234567890';

let _warnedAboutFallback = false;

function getSecret(): Uint8Array {
  if (env.BLACKNEL_COOKIE_SECRET) {
    return new TextEncoder().encode(env.BLACKNEL_COOKIE_SECRET);
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'BLACKNEL_COOKIE_SECRET must be set in production. Generate one with: ' +
        'node -e "console.log(crypto.randomBytes(48).toString(\'base64url\'))"',
    );
  }
  if (!_warnedAboutFallback && env.NODE_ENV !== 'test') {
    _warnedAboutFallback = true;
    log.warn(
      { env: env.NODE_ENV },
      'auth.cookie.using_dev_fallback_secret — sessions are not safe for production',
    );
  }
  return new TextEncoder().encode(DEV_SECRET_FALLBACK);
}

/**
 * Sign a session into a JWT (HS256). Returns the raw token string —
 * `setSession()` in `./server.ts` wraps it as an HTTP-only cookie.
 */
export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ ...session, v: SESSION_COOKIE_VERSION })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Verify and decode. Returns `null` on any failure (expired, tampered,
 * wrong version, malformed) — callers treat `null` as "no session".
 */
export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ['HS256'],
    });
    if (typeof payload.v !== 'number' || payload.v !== SESSION_COOKIE_VERSION) {
      return null;
    }
    if (
      typeof payload.userId !== 'string' ||
      typeof payload.orgId !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.email !== 'string'
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      orgId: payload.orgId,
      role: payload.role as Session['role'],
      email: payload.email,
      ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
    };
  } catch (err) {
    log.debug({ err }, 'auth.cookie.verify_failed');
    return null;
  }
}
