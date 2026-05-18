import 'server-only';

import { sql } from 'drizzle-orm';

import type { Session } from '@/lib/auth/types';
import { dbAdmin } from '@/lib/db/client';
import { AppError } from '@/lib/errors';

import type { Permission } from './roles';

/**
 * Phase 10 / Commit 36a — dual TS+DB enforcement primitive.
 *
 * Phase 11 / Commit 42c — promoted to **triple** TS+DB+RLS defense-
 * in-depth on four critical tables. See "Three layers" below.
 *
 * # Why this exists
 *
 * The 144 `authorize(session.role, permission)` callers across
 * the codebase enforce permissions at the TS layer. For the 10
 * **critical actions** documented in
 * `doc/PATTERNS.md#critical-actions`, that is not enough. A bug
 * in the TS layer (e.g. forgetting to call `authorize()` before a
 * sensitive operation) would let a malicious or buggy code path
 * through.
 *
 * `assertPermissionInDb()` invokes the Postgres function
 * `app_permission_check(user_id, org_id, permission)` (migration
 * 0018) which resolves permissions via the SAME revoke-wins rule
 * as `lib/custom-roles/resolve.ts` but reads the live DB state
 * (`organization_members.custom_role_id` + `custom_roles` +
 * `role_permissions`). Bypass of the TS layer cannot bypass this.
 *
 * # Three layers (Phase 11 / C42c onward)
 *
 *   Layer 1 — `authorize(role, permission)` in TS Server Actions.
 *             Fast, mock-friendly, every caller hits it.
 *   Layer 2 — `assertPermissionInDb(session, permission)` HERE.
 *             DB round-trip; used by the 10 critical actions; bypass
 *             of layer 1 is caught here.
 *   Layer 3 — RESTRICTIVE RLS policies on `posts UPDATE/DELETE`,
 *             `audit_events SELECT`, `custom_roles INSERT/UPDATE/DELETE`
 *             (migration 0023). Bypass of layers 1+2 is caught here.
 *
 * Layer 3 is gated by the `blacknel.rls_dynamic` Postgres setting
 * (operator-flipped via `pnpm db:rls on/off`). When the setting is
 * `off` (default), layer 3 short-circuits and layers 1+2 are the
 * only enforcement — that is the rollback path documented in
 * `doc/runbooks/rls-rollback.md`.
 *
 * **Do NOT remove `assertPermissionInDb()` calls** when C42c ships.
 * Layer 2 is the fallback that lets the operator flip layer 3 off
 * without losing security guarantees. Removal happens (if at all)
 * in C50 closure pass after months of stable layer-3 operation.
 *
 * # When to use
 *
 * Add a call to `assertPermissionInDb(session, permission)` to
 * Server Actions that perform any of the 10 critical actions
 * listed in `doc/PATTERNS.md`. Do not use elsewhere — every
 * caller is a DB round-trip.
 *
 * # Performance
 *
 * Sub-ms per call (PK lookup + small CTE). Tracked in
 * `TODO.md#rbac-permission-check-perf-budget` — if Phase 11
 * load tests show p95 > 10ms, add an LRU cache layer with
 * invalidation on custom_role mutation.
 */
/**
 * Drizzle's `tx.execute` returns `{ rows: [...] }` on postgres-js
 * and on the current pglite adapter (older pglite returned a
 * plain array). Normalize so callers always get an array of rows.
 */
function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybe = (result as { rows?: T[] } | null)?.rows;
  return Array.isArray(maybe) ? maybe : [];
}

export async function assertPermissionInDb(
  session: Session,
  permission: Permission,
): Promise<void> {
  const allowed = await dbAdmin(async (tx) => {
    const result = await tx.execute(
      sql`SELECT app_permission_check(${session.userId}::uuid, ${session.orgId}::uuid, ${permission}) AS ok`,
    );
    const rows = asRows<{ ok: boolean }>(result);
    return rows[0]?.ok === true;
  });
  if (!allowed) {
    throw new AppError(
      'FORBIDDEN',
      `DB cross-check denied permission "${permission}" for the current session.`,
      {
        meta: {
          permission,
          userId: session.userId,
          orgId: session.orgId,
          role: session.role,
          customRoleId: session.customRoleId ?? null,
        },
      },
    );
  }
}

/**
 * Predicate variant — returns the DB answer without throwing.
 * Useful when the caller wants to decide between an auth error
 * vs a different code path (e.g. soft-degrade UI), or for tests.
 */
export async function checkPermissionInDb(
  session: Session,
  permission: Permission,
): Promise<boolean> {
  return dbAdmin(async (tx) => {
    const result = await tx.execute(
      sql`SELECT app_permission_check(${session.userId}::uuid, ${session.orgId}::uuid, ${permission}) AS ok`,
    );
    const rows = asRows<{ ok: boolean }>(result);
    return rows[0]?.ok === true;
  });
}
