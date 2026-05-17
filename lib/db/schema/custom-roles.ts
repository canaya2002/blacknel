import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { customRoleStatusEnum, memberRoleEnum } from './_enums';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Enterprise-tier RBAC overlay (Phase 10 / Commit 36a).
 *
 * # Resolution rule — revoke-wins (documented in 3 places)
 *
 * For a member assigned to a custom_role, the effective permission
 * set is:
 *
 *   IF permission ∈ revokes → false
 *   ELIF permission ∈ grants → true
 *   ELSE permission ∈ role_permissions[base_role]
 *
 * Documented in:
 *   1. This JSDoc.
 *   2. JSDoc of `lib/custom-roles/resolve.ts` (TS impl).
 *   3. SQL function comment on `app_permission_check`
 *      (migration 0018).
 *   4. Empirically verified in
 *      `tests/unit/custom-roles-resolution.test.ts` (test #5).
 *
 * # base_role policy
 *
 * `base_role` cannot be `'owner'` — owner is a singleton (the
 * organization creator) and represents irrevocable rights. The
 * CHECK constraint `custom_roles_base_not_owner` enforces this at
 * DB layer; Zod schemas re-enforce at app layer.
 *
 * # grants/revokes shape
 *
 * Both are `text[] NOT NULL DEFAULT '{}'`. The DB enforces
 * canonical permission format (`<area>:<verb>` lowercase) via the
 * `app_valid_permission_format()` IMMUTABLE function — see
 * migration 0018 for the implementation note (CHECK with
 * subquery is not allowed in Postgres standard; IMMUTABLE
 * function call is the canonical workaround).
 *
 * The Zod schema in `lib/custom-roles/validate.ts` does the full
 * semantic whitelist check against the `Permission` union from
 * `lib/permissions/roles.ts`.
 */
export const customRoles = pgTable(
  'custom_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    baseRole: memberRoleEnum('base_role').notNull(),
    grants: text('grants').array().notNull().default(sql`'{}'::text[]`),
    revokes: text('revokes').array().notNull().default(sql`'{}'::text[]`),
    status: customRoleStatusEnum('status').notNull().default('active'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    orgStatusIdx: index('custom_roles_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
    orgActiveIdx: index('custom_roles_org_active_idx')
      .on(table.organizationId)
      .where(sql`status = 'active'`),
    orgNameUnique: uniqueIndex('custom_roles_org_name_unique').on(
      table.organizationId,
      table.name,
    ),
    nameLength: check(
      'custom_roles_name_length',
      sql`length(btrim(name)) BETWEEN 1 AND 60`,
    ),
    baseNotOwner: check(
      'custom_roles_base_not_owner',
      sql`base_role <> 'owner'`,
    ),
    grantsFormat: check(
      'custom_roles_grants_format',
      sql`app_valid_permission_format(grants)`,
    ),
    revokesFormat: check(
      'custom_roles_revokes_format',
      sql`app_valid_permission_format(revokes)`,
    ),
  }),
);

export type CustomRole = typeof customRoles.$inferSelect;
export type NewCustomRole = typeof customRoles.$inferInsert;
export type CustomRoleStatus = CustomRole['status'];
