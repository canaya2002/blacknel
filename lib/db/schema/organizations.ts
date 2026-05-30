import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organizationStatusEnum } from './_enums';
import { plans } from './plans';

/**
 * Top-level tenant. Every business entity in Blacknel ultimately belongs
 * to exactly one organization — RLS uses `organization_id` as the
 * isolation key, set via `app.current_org_id` in `dbAs()`.
 *
 * `created_by` references `users.id` — declared in SQL to avoid a
 * circular import between `users` and `organizations`.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'restrict' }),
    /** FK to `users.id` declared in SQL (circular). */
    createdBy: uuid('created_by'),
    billingEmail: text('billing_email'),
    country: text('country').notNull().default('US'),
    locale: text('locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('UTC'),
    status: organizationStatusEnum('status').notNull().default('active'),
    /** White-label branding (C52) — nullable; resolver falls back to Blacknel. */
    displayName: text('display_name'),
    logoUrl: text('logo_url'),
    primaryColor: text('primary_color'),
    secondaryColor: text('secondary_color'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: index('organizations_slug_idx').on(table.slug),
    statusIdx: index('organizations_status_idx').on(table.status),
  }),
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
