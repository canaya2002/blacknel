import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * System singleton key/value store (migration 0024). GLOBAL, not per-tenant —
 * NO RLS by design (service_role writes, authenticated reads via GRANT). Holds
 * operator-flippable runtime flags:
 *   - `rls_dynamic`  ∈ {on,off}  — C42c dynamic-RLS gate.
 *   - `use_real_ai`  ∈ {on,off}  — C43a real-AI cutover gate (migration 0028).
 *
 * Written by scripts/{rls-switch,ai-switch}.ts; read in TS via this model
 * (lib/ai/runtime-flag.ts) and SQL helpers (app_rls_dynamic_enabled()).
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
