import {
  permissionAllowed,
  resolvePermissions,
} from '../custom-roles/resolve';
import type { CustomRoleInput } from '../custom-roles/types';
import { AppError } from '../errors';

import { type Permission, ROLE_PERMISSIONS, type Role } from './roles';

/**
 * Pure predicate: does `role` carry `permission` according to the
 * global matrix in `ROLE_PERMISSIONS`?
 *
 * No DB access. The role-to-permission matrix is invariant per-tenant
 * in Phase 1. Per-org custom roles arrive in Phase 10; that future
 * version will accept an `orgId` and look up overrides — the shape
 * stays compatible.
 */
export function can(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms.includes(permission);
}

/**
 * Throwing variant for use at the top of Server Actions / Route
 * Handlers. Throws `AppError('FORBIDDEN')` with structured meta so the
 * caller boundary can render the right 403 message.
 */
export function authorize(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new AppError('FORBIDDEN', `Role "${role}" lacks permission "${permission}".`, {
      meta: { role, permission },
    });
  }
}

/**
 * Convenience for code that already holds the current Session and just
 * wants a boolean.
 */
export function sessionCan(
  session: { role: Role } | null,
  permission: Permission,
): boolean {
  if (!session) return false;
  return can(session.role, permission);
}

/**
 * Phase 10 / Commit 36a — Custom Roles-aware permission resolver.
 *
 * Re-exposes `permissionAllowed` from `lib/custom-roles/resolve`
 * so callers holding the session AND optionally the resolved
 * custom_role row can check permissions with the revoke-wins rule.
 * The 144 pre-C36a `authorize()` / `can()` callers do NOT need to
 * migrate — their behavior is preserved exactly (custom_role
 * defaults to undefined → matrix lookup as before).
 */
export function resolvePermissionsFor(
  role: Role,
  customRole: CustomRoleInput | null | undefined,
  permission: Permission,
): boolean {
  return permissionAllowed(role, permission, customRole);
}

/**
 * Phase 10 / Commit 36a — full effective set resolver (for UI
 * gating or audit). Returns the Set of permissions the (role,
 * customRole) pair effectively holds after applying revoke-wins.
 */
export function resolveEffectivePermissionsFor(
  role: Role,
  customRole: CustomRoleInput | null | undefined,
): ReadonlySet<Permission> {
  return resolvePermissions(role, customRole).effective;
}
