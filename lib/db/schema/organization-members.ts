import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { memberRoleEnum, memberStatusEnum } from './_enums';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Join table between users and organizations with a per-membership role.
 * A user can be a member of many orgs; their role is org-scoped.
 *
 * RLS isolates rows by `organization_id`. The `can()` helper
 * (Commit 3) reads the `role` of the current user inside the current
 * org and derives permissions from it.
 */
export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull(),
    status: memberStatusEnum('status').notNull().default('active'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgUserUnique: uniqueIndex('organization_members_org_user_unique').on(
      table.organizationId,
      table.userId,
    ),
    userIdx: index('organization_members_user_idx').on(table.userId),
    orgStatusIdx: index('organization_members_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
  }),
);

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
