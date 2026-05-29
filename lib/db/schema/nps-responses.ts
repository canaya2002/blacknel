import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Postgres `inet` column. drizzle-orm/pg-core has no first-class `inet`
 * type; modelling it as plain text drifts from the SQL (`ip_address inet`
 * in 0015) and would make `drizzle-kit` want to ALTER the column. This
 * customType matches the real column type exactly. Stored/read as string.
 */
const inet = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'inet';
  },
});

import { npsResponseCategoryEnum } from './_enums';
import { npsInvitations } from './nps-invitations';
import { organizations } from './organizations';

/**
 * Recorded NPS response (Phase 9 / Commit 32).
 *
 * `category` is a STORED generated column (D-32-6) — Postgres derives
 * the bucket from `score` at INSERT time:
 *
 *   score 9-10  → promoter
 *   score 7-8   → passive
 *   score 0-6   → detractor
 *
 * The Drizzle column is annotated for `$inferSelect` typing only;
 * inserts MUST NOT pass `category` (Postgres rejects writes to
 * generated columns). The integration tests (`tests/unit/nps-score-
 * category.test.ts`) verify the boundaries empirically.
 *
 * `nps_responses_detractor_comment` (D-32-3): score ≤ 6 must include a
 * non-empty comment. Validated client-side, server-side, AND at the DB
 * — defense in depth.
 *
 * `ip_address inet` is anonymized at app layer (Phase-11 compliance).
 * `user_agent` is stored raw; a Phase-12 cleanup will move it behind
 * a `metadata` blob if we end up needing more per-response context.
 */
export const npsResponses = pgTable(
  'nps_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    npsInvitationId: uuid('nps_invitation_id')
      .notNull()
      .references(() => npsInvitations.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    // GENERATED ALWAYS AS … STORED — read-only from app code. The
    // `.generatedAlwaysAs(...)` annotation tells Drizzle 0.36+ to
    // omit this column from `$inferInsert` so callers cannot pass it
    // by mistake (Postgres rejects writes to generated columns).
    category: npsResponseCategoryEnum('category')
      .notNull()
      .generatedAlwaysAs(
        sql`CASE
          WHEN score >= 9 THEN 'promoter'::nps_response_category
          WHEN score >= 7 THEN 'passive'::nps_response_category
          ELSE 'detractor'::nps_response_category
        END`,
      ),
    comment: text('comment'),
    respondedAt: timestamp('responded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    onePerInvitation: uniqueIndex('nps_responses_one_per_invitation').on(
      table.npsInvitationId,
    ),
    orgRespondedIdx: index('nps_responses_org_responded_idx').on(
      table.organizationId,
      table.respondedAt,
    ),
    orgCategoryIdx: index('nps_responses_org_category_idx').on(
      table.organizationId,
      table.category,
    ),
    scoreRange: check(
      'nps_responses_score_range',
      sql`score >= 0 AND score <= 10`,
    ),
    detractorComment: check(
      'nps_responses_detractor_comment',
      sql`score >= 7 OR (comment IS NOT NULL AND length(btrim(comment)) > 0)`,
    ),
  }),
);

export type NpsResponse = typeof npsResponses.$inferSelect;
export type NpsResponseCategory = NpsResponse['category'];
export type NewNpsResponse = typeof npsResponses.$inferInsert;
