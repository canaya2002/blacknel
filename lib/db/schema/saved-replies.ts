import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { brands } from './brands';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Reusable reply snippets — "saved replies" / "canned responses".
 *
 * `body` may include placeholders matched by the whitelist in
 * `lib/inbox/saved-reply-variables.ts`. Anything outside the whitelist
 * throws at substitute-time — never `eval`, never template-literal eval.
 *
 * `variables` is the list of placeholder names this reply expects, for UX
 * (the composer can prompt for the values). The substitution helper does
 * NOT trust this list — it whitelists at the resolver layer.
 */
export const savedReplies = pgTable(
  'saved_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category'),
    language: text('language').notNull().default('es'),
    body: text('body').notNull(),
    variables: jsonb('variables').notNull().default(sql`'[]'::jsonb`),
    platformsAllowed: jsonb('platforms_allowed').notNull().default(sql`'[]'::jsonb`),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('saved_replies_org_idx').on(table.organizationId),
    orgCategoryIdx: index('saved_replies_org_category_idx').on(
      table.organizationId,
      table.category,
    ),
  }),
);

export type SavedReply = typeof savedReplies.$inferSelect;
export type NewSavedReply = typeof savedReplies.$inferInsert;
