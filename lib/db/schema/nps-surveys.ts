import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  npsSurveyStatusEnum,
  npsSurveyTriggerEnum,
} from './_enums';
import { brands } from './brands';
import { organizations } from './organizations';

/**
 * NPS survey configuration (Phase 9 / Commit 32).
 *
 * One row per "kind" of survey — for example, "Post-consulta NPS" with
 * trigger=post_resolution + channels=[email,whatsapp]. The sender
 * (`lib/nps/sender.ts`) and triggers (`lib/nps/triggers.ts`) read this
 * row to decide who gets invited and how.
 *
 * `channels` is a Postgres array of `nps_survey_channel`. Drizzle's
 * pgArray typing is loose so we expose the column as an array of the
 * raw enum strings (TypeScript-side narrowing happens in the read
 * layer).
 *
 * `brand_id` nullable — null applies to ALL brands inside the org.
 *
 * `min_days_between_sends` is the throttle the sender consults before
 * dispatching: if the same contact received an invitation from THIS
 * survey within this many days, skip them. Default 90 matches
 * industry-standard NPS frequency caps.
 */
export const npsSurveys = pgTable(
  'nps_surveys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    trigger: npsSurveyTriggerEnum('trigger').notNull(),
    // Postgres `nps_survey_channel[]`. Drizzle 0.36 doesn't model array
    // typing on custom enums cleanly, so we use a `text[]`-equivalent
    // and narrow at the read layer.
    channels: text('channels')
      .array()
      .notNull(),
    questionText: text('question_text').notNull(),
    thankYouMessage: text('thank_you_message'),
    locale: text('locale').notNull().default('es'),
    status: npsSurveyStatusEnum('status').notNull().default('draft'),
    minDaysBetweenSends: integer('min_days_between_sends')
      .notNull()
      .default(90),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    orgStatusIdx: index('nps_surveys_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
    orgTriggerActiveIdx: index('nps_surveys_org_trigger_idx')
      .on(table.organizationId, table.trigger)
      .where(sql`status = 'active'`),
    channelsNonempty: check(
      'nps_surveys_channels_nonempty',
      sql`cardinality(channels) >= 1`,
    ),
    minDaysNonneg: check(
      'nps_surveys_min_days_nonneg',
      sql`min_days_between_sends >= 0`,
    ),
  }),
);

export type NpsSurvey = typeof npsSurveys.$inferSelect;
export type NewNpsSurvey = typeof npsSurveys.$inferInsert;

export type NpsSurveyTrigger = NpsSurvey['trigger'];
export type NpsSurveyStatus = NpsSurvey['status'];
export type NpsSurveyChannel = 'email' | 'whatsapp' | 'sms_reserved';
