import { bigint, doublePrecision, pgTable, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations';

/**
 * Persisted token bucket for per-org AI rate limiting (C43b, migration 0029).
 * Survives Vercel cold starts (no in-memory state) — one row per org, refilled
 * continuously by elapsed time in `lib/ai/rate-limit.ts`. System table: written
 * only via `dbAdmin` (service_role); never read by end-users → NO RLS (same
 * posture as `meta_webhook_events`).
 */
export const aiRateBuckets = pgTable('ai_rate_buckets', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  /** Fractional tokens available (allows sub-token continuous refill). */
  tokens: doublePrecision('tokens').notNull(),
  /** App-set epoch ms of the last refill/consume (clock lives in the app). */
  updatedAtMs: bigint('updated_at_ms', { mode: 'number' }).notNull(),
});

export type AiRateBucket = typeof aiRateBuckets.$inferSelect;
export type NewAiRateBucket = typeof aiRateBuckets.$inferInsert;
