import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Mirror of `auth.users` from Supabase Auth (GoTrue). The `id` is set to
 * match `auth.users.id` by the `on_auth_user_created` trigger defined in
 * migration `0003_triggers.sql`.
 *
 * Users are GLOBAL — they can belong to multiple organizations via
 * `organization_members`. The `default_organization_id` is a pointer to
 * the org the UI opens by default after sign-in; the FK is added in SQL
 * to avoid a circular import between `users` and `organizations`.
 */
export const users = pgTable(
  'users',
  {
    /** Matches `auth.users.id`. Populated by the auth trigger, not by app code. */
    id: uuid('id').primaryKey().notNull(),
    email: text('email').notNull(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    locale: text('locale').notNull().default('en'),
    /** FK to `organizations.id` (declared in SQL — circular reference). Nullable. */
    defaultOrganizationId: uuid('default_organization_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: index('users_email_idx').on(table.email),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
