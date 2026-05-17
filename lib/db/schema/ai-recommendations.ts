import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { aiRecCategoryEnum, aiRecStatusEnum } from './_enums';
import { aiGenerations } from './ai-generations';
import { brands } from './brands';
import { organizations } from './organizations';
import { users } from './users';

/**
 * AI-driven recommendations with a lifecycle distinct from a
 * one-shot `ai_generations` row (Commit 22 — table only; consumers
 * land in Commits 24-25 with crisis detection + brand-voice
 * recommendations).
 *
 * A recommendation is the durable, human-decidable surface; the
 * underlying generation that produced it is the audit trail
 * (`generation_id` FK).
 *
 * Status graph:
 *   pending → accepted | dismissed (both terminal)
 *
 * Categories (Commit 22 places the table; per-category producers
 * land in later commits):
 *   - `crisis`            — pattern detection in reviews / inbox
 *   - `brand_voice_tone`  — tone drift from recent generations
 *   - `response_template` — recurring inbox replies worth saving
 *   - `audience_insight`  — engagement / sentiment cohort signals
 */
export const aiRecommendations = pgTable(
  'ai_recommendations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    category: aiRecCategoryEnum('category').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    status: aiRecStatusEnum('status').notNull().default('pending'),
    /**
     * Supporting evidence the producer recorded. Free-form per
     * category — e.g. crisis recs carry `{ matchedReviewIds: [...],
     * avgRatingDelta: -1.4 }`.
     */
    evidence: jsonb('evidence').notNull().default(sql`'{}'::jsonb`),
    generationId: uuid('generation_id').references(() => aiGenerations.id, {
      onDelete: 'set null',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index('ai_recommendations_org_status_idx').on(
      table.organizationId,
      table.status,
      table.createdAt.desc(),
    ),
    generationIdx: index('ai_recommendations_generation_idx').on(
      table.generationId,
    ),
  }),
);

export type AiRecommendation = typeof aiRecommendations.$inferSelect;
export type NewAiRecommendation = typeof aiRecommendations.$inferInsert;
