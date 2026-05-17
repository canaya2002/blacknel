import {
  type Permission,
  ROLE_PERMISSIONS,
  type Role,
} from '@/lib/permissions/roles';

import type { CustomRoleInput, PermissionResolution } from './types';

/**
 * Phase 10 / Commit 36a — pure permission resolution.
 *
 * # Resolution rule — revoke-wins (D-36a-3, documented in 3 places)
 *
 *   IF permission ∈ revokes → false
 *   ELIF permission ∈ grants → true
 *   ELSE permission ∈ ROLE_PERMISSIONS[base_role]
 *
 * Documented in:
 *   1. JSDoc of `lib/db/schema/custom-roles.ts`.
 *   2. This JSDoc.
 *   3. SQL function comment on `app_permission_check` (migration 0018).
 *   4. Empirically verified in
 *      `tests/unit/custom-roles-resolution.test.ts` (test #5).
 *
 * # Purity guarantees
 *
 * - **Pure function**: no I/O, no Date.now(), no mutable closures.
 * - **Idempotent**: `resolvePermissions(X) === resolvePermissions(X)`
 *   in value (Sets compared by membership). Verified in test #21.
 * - **Order-independent**: iteration order of the input arrays
 *   does not change the output Set membership. Postgres
 *   `app_permission_check` mirrors this — both use set semantics.
 *
 * # When `customRole` is null/undefined
 *
 * Returns exactly `ROLE_PERMISSIONS[role]` — identical to the
 * legacy `can()` behavior pre-Commit-36a. Test #18 verifies this
 * fallback path.
 */
export function resolvePermissions(
  role: Role,
  customRole?: CustomRoleInput | null,
): PermissionResolution {
  const basePermissions = new Set<Permission>(
    (customRole ? ROLE_PERMISSIONS[customRole.baseRole] : ROLE_PERMISSIONS[role]) ?? [],
  );
  const grants = new Set<Permission>(customRole?.grants ?? []);
  const revokes = new Set<Permission>(customRole?.revokes ?? []);

  // revoke-wins: first remove revoked, then union with grants
  // (an item in BOTH grants and revokes stays out — revoke wins).
  const effective = new Set<Permission>();
  for (const p of basePermissions) {
    if (!revokes.has(p)) effective.add(p);
  }
  for (const p of grants) {
    if (!revokes.has(p)) effective.add(p);
  }

  return {
    basePermissions,
    grants,
    revokes,
    effective,
  };
}

/**
 * Predicate variant — same answer as `app_permission_check()` SQL
 * function. The 10 critical actions invoke `assertPermissionInDb()`
 * which calls the SQL function; this TS predicate is for the
 * other 134 callers that stay TS-only.
 */
export function permissionAllowed(
  role: Role,
  permission: Permission,
  customRole?: CustomRoleInput | null,
): boolean {
  return resolvePermissions(role, customRole).effective.has(permission);
}
