import type { Permission, Role } from '@/lib/permissions/roles';

/**
 * Phase 10 / Commit 36a — Custom Roles type contracts.
 *
 * The TS layer + DB layer share the same shape so the resolution
 * function (`lib/custom-roles/resolve.ts`) and the SQL function
 * (`app_permission_check()`) can be cross-validated.
 */

export interface CustomRoleInput {
  /** Base role used as the permission floor for resolution. */
  readonly baseRole: Exclude<Role, 'owner'>;
  /** Permissions added on top of base_role's set. */
  readonly grants: ReadonlyArray<Permission>;
  /** Permissions removed from the base_role + grants union. */
  readonly revokes: ReadonlyArray<Permission>;
}

export interface PermissionResolution {
  readonly basePermissions: ReadonlySet<Permission>;
  readonly grants: ReadonlySet<Permission>;
  readonly revokes: ReadonlySet<Permission>;
  readonly effective: ReadonlySet<Permission>;
}
