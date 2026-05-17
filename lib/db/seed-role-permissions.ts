import 'server-only';

import { rolePermissions } from './schema';

import {
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from '../permissions/roles';

import type { AnyPgTx } from './client';

/**
 * Phase 10 / Commit 36a — seed the `role_permissions` table from
 * the `ROLE_PERMISSIONS` TS matrix.
 *
 * # ALWAYS runs first in seedDatabase. NOT env-gated.
 *
 * RBAC core depends on this table being populated and in sync
 * with the `ROLE_PERMISSIONS` TS matrix. Without these rows,
 * `app_permission_check()` falls back to "no permissions" for
 * EVERY user — total auth lockout.
 *
 * Run after every change to the TS matrix. Tests pass because
 * `seedDatabase()` calls this first; production passes because
 * the Phase 11 cutover keeps this seed as the boot bootstrap.
 *
 * # DELETE+INSERT (idempotent)
 *
 * The matrix changes from commit to commit (we ADD permissions
 * in C32/C33/C34, will add more in C36b). A pure ON CONFLICT
 * leaves stale rows for permissions that have been removed.
 * DELETE+INSERT guarantees the table mirrors the live TS matrix
 * exactly after each seed.
 */
export async function seedRolePermissions(tx: AnyPgTx): Promise<void> {
  const rows = (Object.keys(ROLE_PERMISSIONS) as Role[]).flatMap((role) =>
    (ROLE_PERMISSIONS[role] as ReadonlyArray<Permission>).map((permission) => ({
      role,
      permission,
    })),
  );
  await tx.delete(rolePermissions);
  if (rows.length > 0) {
    await tx.insert(rolePermissions).values(rows);
  }
}
