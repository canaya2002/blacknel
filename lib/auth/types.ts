import type { Role } from '../permissions/roles';

/**
 * Authenticated request context, available to every Server Action and
 * Route Handler via `getSession()` / `requireUser()`.
 *
 * Lives entirely inside the signed session cookie in Phases 1-10 (no
 * roundtrip to a session store / Supabase Auth needed). Phase 11
 * replaces the issuer with Supabase Auth; the shape stays the same.
 *
 * Adding fields here is a breaking change for existing cookies — bump
 * `SESSION_COOKIE_VERSION` in `./cookie.ts` so old cookies are
 * invalidated cleanly.
 */
export interface Session {
  userId: string;
  /** Currently selected organization. Single-org users have one fixed value. */
  orgId: string;
  /** Caller's role inside `orgId`. Source of truth for `can()` checks. */
  role: Role;
  /** Display name shown in the topbar avatar tooltip. Optional / cosmetic. */
  name?: string;
  email: string;
}
