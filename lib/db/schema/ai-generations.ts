import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { aiActorTypeEnum, aiSkillEnum } from './_enums';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Persistence layer for the Claude SDK adapter (Phase 7 / Commit 22).
 *
 * Every adapter `.generate()` call writes one row — mock today
 * (`via='mock'` recorded in `input.via`), real in Phase 11. The
 * surfaces that consume this table:
 *
 *   - `/audit/ai` cost dashboard (Commit 22, Ajuste 2)
 *   - Phase 11 budget alerts ("you've burned 90% of monthly cap")
 *   - Per-entity audit ("show every AI generation that touched
 *     this thread") — drives the "AI involved" pill on the
 *     inbox / reviews detail surfaces
 *   - Phase-11+ prompt A/B testing via `input.promptVersion`
 *
 * Stable indexed columns are the query keys; `input` / `output`
 * jsonb are the debug surfaces (every skill stores its own
 * structured payload).
 *
 * # `input.promptVersion`
 *
 * Per the Commit 22 / Ajuste 3 rule, every system prompt carries
 * an explicit version (`v1`, `v2`, …). The adapter records the
 * version inside `input.promptVersion` so dashboards can group
 * outputs by version (rollback / A/B test).
 *
 * # `request_hash`
 *
 * sha256 of `(skill | model | systemPrompt | userPrompt |
 * canonicalJson(input))`. Drives the 5-min dedup window:
 * a second `.generate()` call with the same hash returns the
 * cached output without paying for tokens.
 */
export const aiGenerations = pgTable(
  'ai_generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /**
     * `user_id` is NULL for the system path (e.g. the Phase-7 crisis
     * scan cron). Real-user calls (compose / reply) carry the
     * actor's id so audit trail attributes correctly.
     */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    actorType: aiActorTypeEnum('actor_type').notNull(),
    skill: aiSkillEnum('skill').notNull(),
    /** `'claude-haiku-4-5'` | `'claude-opus-4-7'`. */
    model: text('model').notNull(),
    requestHash: text('request_hash').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    /** Prompt-cached tokens (Anthropic 90% discount). */
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costCents: integer('cost_cents').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    /** True when the 5-min dedup window returned a cached output. */
    cacheHit: boolean('cache_hit').notNull().default(false),
    /** `'inbox_message' | 'review' | 'post' | 'thread' | 'org'` etc. */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    input: jsonb('input').notNull().default(sql`'{}'::jsonb`),
    output: jsonb('output').notNull().default(sql`'{}'::jsonb`),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    /**
     * Causal linkage for the compliance dual-model cascade
     * (Commit 23 / Ajuste 1). NULL for baseline calls; set to
     * the baseline row's `id` for the Opus second-pass row.
     * The partial index (`ai_generations_parent_idx`) covers
     * the non-null slice.
     */
    parentGenerationId: uuid('parent_generation_id').references(
      (): AnyPgColumn => aiGenerations.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgCreatedIdx: index('ai_generations_org_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
    ),
    hashIdx: index('ai_generations_hash_idx').on(
      table.organizationId,
      table.requestHash,
      table.createdAt.desc(),
    ),
    entityIdx: index('ai_generations_entity_idx').on(
      table.entityType,
      table.entityId,
      table.skill,
    ),
    // Partial index — only non-null parent rows (cascades).
    parentIdx: index('ai_generations_parent_idx')
      .on(table.organizationId, table.parentGenerationId)
      .where(sql`${table.parentGenerationId} IS NOT NULL`),
  }),
);

export type AiGeneration = typeof aiGenerations.$inferSelect;
export type NewAiGeneration = typeof aiGenerations.$inferInsert;
