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
  /**
   * Phase 10 / Commit 36a — Custom Roles overlay reference.
   *
   * Optional field, added without bumping `SESSION_COOKIE_VERSION`
   * (D-36a-9). Existing cookies missing this field parse with
   * `undefined` → treated as `null` → resolution falls back to
   * `role` exactly as pre-C36a behavior.
   *
   * Populated by `assignCustomRoleAction` (C36b) when an admin
   * assigns a member to a custom role. Stale data possible
   * between assignment and next login (≤24h); the 10 critical
   * actions (`doc/PATTERNS.md`) cross-check via
   * `assertPermissionInDb()` which reads live DB state.
   */
  customRoleId?: string | null;
  /** Display name shown in the topbar avatar tooltip. Optional / cosmetic. */
  name?: string;
  email: string;
}
