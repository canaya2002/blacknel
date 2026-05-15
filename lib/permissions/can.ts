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
