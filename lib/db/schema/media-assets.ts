import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations';
import { users } from './users';

/**
 * R2-backed user media (Phase 11 / C44). One row per object uploaded via the
 * presigned-PUT flow (lib/storage/media). Distinct from `content_assets` (the
 * composer's curated asset library, served by the legacy DevFilesystemProvider)
 * — `media_assets` is the lower-level R2 storage layer with quota + lifecycle.
 *
 * Lifecycle: `pending` (presigned URL issued) → `ready` (client confirmed the
 * upload) → `deleted` (object removed). The cleanup-pending-uploads cron
 * (Inngest) reaps `pending` rows older than 24h + their R2 objects.
 *
 * `key` is the tenant-namespaced object key: `orgs/{orgId}/media/{uuid}.{ext}`.
 * Tenant-scoped by RLS (organization_id).
 */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** R2 object key: orgs/{orgId}/media/{uuid}.{ext}. */
    key: text('key').notNull(),
    bucket: text('bucket').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    originalFilename: text('original_filename').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** 'pending' | 'ready' | 'deleted' (DB CHECK in the migration). */
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index('media_assets_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
    orgCreatedIdx: index('media_assets_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
    ),
    orgKeyUnique: uniqueIndex('media_assets_org_key_unique').on(
      table.organizationId,
      table.key,
    ),
  }),
);

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type NewMediaAsset = typeof mediaAssets.$inferInsert;
