import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { planCodeEnum } from './_enums';

/**
 * Plans are global (no `organization_id`). Every org has a single
 * subscription pointing at one of these. The seed inserts standard /
 * growth / enterprise rows; product code reads them through `lib/plans`.
 */
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: planCodeEnum('code').notNull().unique(),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  /** Plan limits as JSON. Shape lives in `lib/plans/plans.ts`. */
  limits: jsonb('limits').notNull().default(sql`'{}'::jsonb`),
  /** Feature flags / availability as JSON. Shape lives in `lib/plans/plans.ts`. */
  features: jsonb('features').notNull().default(sql`'{}'::jsonb`),
  stripePriceId: text('stripe_price_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
