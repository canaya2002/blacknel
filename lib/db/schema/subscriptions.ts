import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { subscriptionStatusEnum } from './_enums';
import { organizations } from './organizations';
import { plans } from './plans';

/**
 * Per-organization active billing plan. Stripe wiring lands in Phase 12;
 * during Phases 1–11 we mutate this table directly when the user changes
 * plan from the Billing UI.
 *
 * One active subscription per organization — enforced by unique index on
 * `organization_id` (we tombstone old ones with status='canceled' rather
 * than delete).
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: subscriptionStatusEnum('status').notNull().default('active'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAt: timestamp('cancel_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stripeIdIdx: index('subscriptions_stripe_idx').on(table.stripeSubscriptionId),
    orgIdx: index('subscriptions_org_idx').on(table.organizationId),
    // Partial unique "one active subscription per org" is enforced by a
    // hand-written CREATE UNIQUE INDEX ... WHERE status='active' in
    // migration `0001_schema.sql` (Drizzle's column builder does not
    // emit partial indexes).
  }),
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
