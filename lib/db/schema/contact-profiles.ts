import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations';

/**
 * Cross-platform contact identity. One row per (org, platform, externalId).
 * Threads reference the contact so we can pull "what else has this person
 * written to us across networks" without joining strings everywhere.
 *
 * `metadata` is opaque — connector-specific fields land here (FB scoped id,
 * Instagram fbid, WhatsApp wa_id, etc.) so the platform-specific schema does
 * not pollute the column list.
 */
export const contactProfiles = pgTable(
  'contact_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    externalId: text('external_id').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    handle: text('handle'),
    language: text('language'),
    tags: jsonb('tags').notNull().default(sql`'[]'::jsonb`),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgPlatformExternalUnique: uniqueIndex('contact_profiles_org_platform_external_unique').on(
      table.organizationId,
      table.platform,
      table.externalId,
    ),
    orgHandleIdx: index('contact_profiles_org_handle_idx').on(
      table.organizationId,
      table.handle,
    ),
  }),
);

export type ContactProfile = typeof contactProfiles.$inferSelect;
export type NewContactProfile = typeof contactProfiles.$inferInsert;
