import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations';

/**
 * Per-organization voice profile applied to AI generations (captions,
 * replies, drafts). One organization can keep multiple voice profiles
 * (e.g., formal, casual, support); `brands.brand_voice_id` selects which
 * profile a brand uses.
 *
 * Loosely shaped — keeps Phase 1 thin. We can tighten shapes once the AI
 * prompt builders land in Phase 7.
 */
export const brandVoices = pgTable(
  'brand_voices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tone: text('tone'),
    style: text('style'),
    allowedEmojis: jsonb('allowed_emojis').notNull().default(sql`'[]'::jsonb`),
    forbiddenWords: jsonb('forbidden_words').notNull().default(sql`'[]'::jsonb`),
    preferredWords: jsonb('preferred_words').notNull().default(sql`'[]'::jsonb`),
    languages: jsonb('languages').notNull().default(sql`'["en"]'::jsonb`),
    ctas: jsonb('ctas').notNull().default(sql`'[]'::jsonb`),
    disclaimers: jsonb('disclaimers').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('brand_voices_org_idx').on(table.organizationId),
  }),
);

export type BrandVoice = typeof brandVoices.$inferSelect;
export type NewBrandVoice = typeof brandVoices.$inferInsert;
