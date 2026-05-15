import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { locationStatusEnum } from './_enums';
import { brands } from './brands';
import { organizations } from './organizations';

/**
 * A physical or logical location owned by a brand — a restaurant
 * franchise outlet, a clinic, a hotel property, etc. Many product
 * features scope further to location (reviews, GBP, NPS by site).
 */
export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    address: text('address'),
    city: text('city'),
    state: text('state'),
    country: text('country'),
    timezone: text('timezone'),
    phone: text('phone'),
    /** Google Business Profile place id, set once the GBP connector is linked. */
    gbpPlaceId: text('gbp_place_id'),
    status: locationStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('locations_org_idx').on(table.organizationId),
    brandIdx: index('locations_brand_idx').on(table.brandId),
  }),
);

export type Location = typeof locations.$inferSelect;
export type NewLocation = typeof locations.$inferInsert;
