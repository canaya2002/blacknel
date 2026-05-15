import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { brandStatusEnum } from './_enums';
import { brandVoices } from './brand-voices';
import { organizations } from './organizations';

/**
 * A brand sits between organizations and the rest of the operational
 * data. Most product features (inbox, posts, reviews, listening) scope
 * to a brand even when the org owns several brands.
 *
 * Slug is unique within an organization, not globally.
 */
export const brands = pgTable(
  'brands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logoUrl: text('logo_url'),
    brandVoiceId: uuid('brand_voice_id').references(() => brandVoices.id, {
      onDelete: 'set null',
    }),
    status: brandStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgSlugUnique: uniqueIndex('brands_org_slug_unique').on(table.organizationId, table.slug),
    orgStatusIdx: index('brands_org_status_idx').on(table.organizationId, table.status),
  }),
);

export type Brand = typeof brands.$inferSelect;
export type NewBrand = typeof brands.$inferInsert;
