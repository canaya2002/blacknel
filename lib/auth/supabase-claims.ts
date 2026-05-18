import 'server-only';

import { decodeJwt, type JWTPayload } from 'jose';

import { log } from '../log';
import { type Role } from '../permissions/roles';

import { createSupabaseServerClient } from './supabase-server';
import { type Session } from './types';

/**
 * Phase 11 / Commit 42a — read the current Supabase session and project
 * it into Blacknel's `Session` shape.
 *
 * # Why decode the JWT directly
 *
 * `@supabase/ssr`'s `auth.getUser()` validates the cookie + returns the
 * `auth.users` row but does NOT return the custom claims our
 * `add_org_claims` Custom Access Token Hook injects. To read those we
 * either (a) duplicate the auth.getUser network roundtrip with a manual
 * fetch of the claims endpoint, or (b) decode the JWT in-memory.
 *
 * (b) is what we do. The JWT signature was already validated by
 * `@supabase/ssr` when it loaded the cookie — there is no extra trust
 * given by re-verifying. Decoding the payload (base64url middle
 * segment) is safe + free.
 *
 * # Claim layout
 *
 * `add_org_claims` injects three TOP-LEVEL keys on the access token:
 *
 *   - `org_id`         (uuid | null)   — default organization
 *   - `role`           (Role | null)   — member role in that org
 *   - `custom_role_id` (uuid | null)   — optional custom-role overlay
 *
 * # Known collision with Supabase native `role` claim
 *
 * Supabase emits a native top-level `role` claim that is normally
 * `'authenticated'`. Our hook OVERWRITES it with the Blacknel role
 * ('owner' / 'admin' / ...). This is fine for the C42a scope (auth
 * cookie + DB queries via postgres-js direct connection) but will
 * conflict in C44 (Supabase Storage RLS policies expect the native
 * role). Track as `phase-11-supabase-claims-namespace` —
 * pre-C44 the hook needs to nest under `blacknel.role` and this
 * decoder updates to match.
 */

export interface SupabaseAccessTokenClaims extends JWTPayload {
  sub: string;
  email?: string;
  // Blacknel custom claims injected by `add_org_claims` hook. See JSDoc above.
  org_id?: string | null;
  role?: string | null;
  custom_role_id?: string | null;
  // Supabase native — overwritten by our hook for the C42a window.
  // We keep the type so future migrations to nested claims are explicit.
}

const VALID_ROLES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'manager',
  'agent',
  'viewer',
]);

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && VALID_ROLES.has(value);
}

/**
 * Pure projection from decoded JWT claims (+ optional metadata) to
 * Blacknel's `Session` shape. Exposed for unit testing — the
 * `getSupabaseSession()` runtime wrapper handles the Supabase fetch and
 * delegates to this for the claim mapping.
 *
 * Returns `null` when the token is missing required fields, or when the
 * user is mid-onboarding (no `org_id` claim yet). The caller decides
 * whether to route an org-less user to `/onboarding/start`.
 */
export function claimsToSession(
  claims: SupabaseAccessTokenClaims,
  metadataName?: unknown,
): Session | null {
  if (!claims.sub || !claims.email) return null;
  if (!claims.org_id || !isRole(claims.role)) return null;

  const session: Session = {
    userId: claims.sub,
    orgId: claims.org_id,
    role: claims.role,
    email: claims.email,
    ...(claims.custom_role_id ? { customRoleId: claims.custom_role_id } : {}),
    ...(typeof metadataName === 'string' ? { name: metadataName } : {}),
  };
  return session;
}

/**
 * Reads the Supabase session, decodes the access-token JWT, and projects
 * the claims into `Session`. Returns `null` when:
 *
 *   - No session cookie present.
 *   - The session is broken / expired / `getSession()` returns no
 *     `access_token`.
 *   - The JWT payload is missing required fields (sub / email).
 *   - The user is mid-onboarding (no `org_id` claim yet) — caller
 *     decides whether to route to /onboarding/start.
 */
export async function getSupabaseSession(): Promise<Session | null> {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (err) {
    log.debug({ err }, 'auth.supabase.client_create_failed');
    return null;
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error || !session?.access_token) {
    if (error) log.debug({ err: error }, 'auth.supabase.get_session_failed');
    return null;
  }

  let claims: SupabaseAccessTokenClaims;
  try {
    claims = decodeJwt<SupabaseAccessTokenClaims>(session.access_token);
  } catch (err) {
    log.debug({ err }, 'auth.supabase.jwt_decode_failed');
    return null;
  }

  return claimsToSession(claims, session.user.user_metadata?.name);
}

/**
 * Sign the current Supabase session out — both the server-side
 * Supabase auth state and the local cookie. Idempotent: calling
 * twice does not raise.
 */
export async function clearSupabaseSession(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch (err) {
    log.warn({ err }, 'auth.supabase.signout_failed');
    // Continue — cookie clearing happens in `clearSession()`
    // (lib/auth/server.ts) and is the operator-visible effect.
  }
}
