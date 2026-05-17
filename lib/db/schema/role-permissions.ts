import { pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

import { memberRoleEnum } from './_enums';

/**
 * System-base role × permission matrix, materialized in DB from
 * `ROLE_PERMISSIONS` in `lib/permissions/roles.ts`.
 *
 * Phase 10 / Commit 36a — this table is the DB-side source of
 * truth that `app_permission_check()` consults. The seed
 * `lib/db/seed-role-permissions.ts` does a DELETE+INSERT on every
 * `seedDatabase()` invocation to capture matrix changes (NOT
 * env-gated — RBAC core depends on it).
 *
 * Test #13 (`tests/integration/custom-roles-defense-in-depth.test.ts`)
 * cross-validates the TS matrix and this table on every (Role,
 * Permission) pair so drift is caught immediately.
 *
 * Global table — no `organization_id` (the matrix is the same for
 * every tenant). RLS allows SELECT to `authenticated`, writes
 * only via `service_role` (seed).
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    role: memberRoleEnum('role').notNull(),
    permission: text('permission').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.role, table.permission] }),
  }),
);

export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;
