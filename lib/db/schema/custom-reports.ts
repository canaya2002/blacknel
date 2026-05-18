import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  customReportShareScopeEnum,
  customReportStatusEnum,
} from './_enums';
import { brands } from './brands';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Enterprise-tier Custom Report Builder (Phase 10 / Commit 39).
 *
 * # Model split (D-39-6 b)
 *
 * Widget positions live ONLY on `custom_report_widgets`. This
 * `layout jsonb` is for grid-level metadata that has no per-widget
 * counterpart: theme, gap_size, header_collapsed, etc. **Strict
 * render-only rule inherited from C38 platform_specific** — no
 * index, no WHERE, no GROUP BY. When a layout field becomes
 * query-relevant, promote to typed column via dedicated migration.
 *
 * # Status lifecycle
 *
 *   draft     → published (publish action, layout validated strict)
 *   published → archived  (terminal)
 *   draft     → archived  (discard before publish)
 *
 * # Share scope (D-39-4)
 *
 * `private` — only `created_by` user.
 * `org_visible` — any org member holding `custom_reports:read`
 *                 permission. NOT membership alone — defense in
 *                 depth via permission check.
 * `specific_users` — explicit allowlist in `shared_with`.
 *
 * # Audit cadence (D-39-10 a)
 *
 * Status transitions audit. Layout edits + widget config updates
 * do NOT (would spam the trail during normal authoring).
 */
export const customReports = pgTable(
  'custom_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    status: customReportStatusEnum('status').notNull().default('draft'),
    /**
     * Grid-level metadata, RENDER-ONLY. See file header for the
     * strict rule. Widget positions are NOT stored here.
     */
    layout: jsonb('layout'),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    shareScope: customReportShareScopeEnum('share_scope')
      .notNull()
      .default('private'),
    sharedWith: uuid('shared_with')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    orgStatusIdx: index('custom_reports_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
    orgCreatedIdx: index('custom_reports_org_created_idx').on(
      table.organizationId,
      table.createdAt,
    ),
    orgCreatorIdx: index('custom_reports_org_creator_idx').on(
      table.organizationId,
      table.createdBy,
    ),
    nameLength: check(
      'custom_reports_name_length',
      sql`length(btrim(name)) BETWEEN 1 AND 120`,
    ),
    publishedHasTimestamp: check(
      'custom_reports_published_has_timestamp',
      sql`status <> 'published' OR published_at IS NOT NULL`,
    ),
    archivedHasTimestamp: check(
      'custom_reports_archived_has_timestamp',
      sql`status <> 'archived' OR archived_at IS NOT NULL`,
    ),
  }),
);

export type CustomReport = typeof customReports.$inferSelect;
export type NewCustomReport = typeof customReports.$inferInsert;
export type CustomReportStatus = CustomReport['status'];
export type CustomReportShareScope = CustomReport['shareScope'];
