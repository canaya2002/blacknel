import 'server-only';

import { sql } from 'drizzle-orm';

import type { Session } from '@/lib/auth/types';
import { dbAdmin } from '@/lib/db/client';
import { AppError } from '@/lib/errors';

import type { Permission } from './roles';

/**
 * Phase 10 / Commit 36a — dual TS+DB enforcement primitive.
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
