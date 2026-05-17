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

import {
  listeningTermKindEnum,
  listeningTermStatusEnum,
} from './_enums';
import { brands } from './brands';
import { organizations } from './organizations';

/**
 * What an org is listening for (Phase 9 / Commit 33).
 *
 * One row per `(org, brand, term, term_kind)`. The same string can
 * live as both a keyword and a hashtag — e.g. `'product-x'` keyword
 * vs `'#product-x'` hashtag — so the kind discriminator is part of
 * the uniqueness key. `brand_id` nullable means "applies to all
 * brands in this org".
 *
 * `platforms` is a Postgres `text[]` of platform codes (facebook,
 * instagram, x, reddit, …). Phase-9 mock connector accepts the
 * subset its mocks know about. Phase-11 swap connects real APIs.
 */
export const listeningTrackedTerms = pgTable(
  'listening_tracked_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    term: text('term').notNull(),
    termKind: listeningTermKindEnum('term_kind').notNull(),
    platforms: text('platforms').array().notNull(),
    status: listeningTermStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    orgStatusIdx: index('listening_tracked_terms_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
    orgActiveIdx: index('listening_tracked_terms_active_idx')
      .on(table.organizationId)
      .where(sql`status = 'active'`),
    orgBrandTermUnique: uniqueIndex(
      'listening_tracked_terms_unique',
    ).on(table.organizationId, table.brandId, table.term, table.termKind),
    platformsNonempty: check(
      'listening_tracked_terms_platforms_nonempty',
      sql`cardinality(platforms) >= 1`,
    ),
  }),
);

export type ListeningTrackedTerm = typeof listeningTrackedTerms.$inferSelect;
export type NewListeningTrackedTerm =
  typeof listeningTrackedTerms.$inferInsert;
export type ListeningTermKind = ListeningTrackedTerm['termKind'];
export type ListeningTermStatus = ListeningTrackedTerm['status'];
