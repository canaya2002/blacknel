import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { contentAssetKindEnum } from './_enums';
import { brands } from './brands';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Asset library entry. One row per uploaded image / video / PDF /
 * GIF. The composer (Commit 19) reads from this table to populate
 * the media picker; posts reference assets by id in
 * `posts.media_ids` jsonb.
 *
 * `url` is the storage URL — local `.blacknel/uploads/...` in dev,
 * Supabase Storage signed URL in Phase 11. The shape stays. The
 * `thumbnail_url` is optional; image assets generate one inline,
 * videos point at the poster frame.
 *
 * `approved` is the Enterprise approval-workflow gate. Standard /
 * Growth orgs auto-approve every upload (we set `approved=true`
 * on insert). Enterprise can flip the seed default to `false` and
 * route uploads through a separate review queue — Phase 10 wires
 * that.
 *
 * `used_count` increments when a post target publishes that
 * references the asset (publish-job side effect, Commit 20). UI
 * uses it to sort by most-used.
 */
export const contentAssets = pgTable(
  'content_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    kind: contentAssetKindEnum('kind').notNull(),
    /** Storage URL — local in dev, Supabase Storage in Phase 11. */
    url: text('url').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    name: text('name').notNull(),
    /** Free-form jsonb array of tag strings. UI filters against this. */
    tags: jsonb('tags').notNull().default(sql`'[]'::jsonb`),
    /** Optional expiry, e.g. a campaign-specific asset. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /**
     * `false` on insert for Enterprise orgs with the asset-approval
     * workflow enabled (Phase 10). Standard / Growth set `true`.
     */
    approved: boolean('approved').notNull().default(true),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Incremented by the publish-job whenever a target succeeds with
     * this asset in its media list. Drives "most-used" sorting in
     * the library.
     */
    usedCount: integer('used_count').notNull().default(0),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgKindIdx: index('content_assets_org_kind_idx').on(table.organizationId, table.kind),
    orgBrandIdx: index('content_assets_org_brand_idx').on(
      table.organizationId,
      table.brandId,
    ),
    orgApprovedIdx: index('content_assets_org_approved_idx').on(
      table.organizationId,
      table.approved,
    ),
  }),
);

export type ContentAsset = typeof contentAssets.$inferSelect;
export type NewContentAsset = typeof contentAssets.$inferInsert;
