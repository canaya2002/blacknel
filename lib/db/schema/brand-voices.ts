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
 *
 * # `metadata.approvalRules` (Commit 19c.3, D-19-1)
 *
 * `metadata` is a free-form jsonb extension blob (migration 0008
 * `0008_brand_voices_metadata.sql`). The publishing flow reads
 * `metadata.approvalRules` to route posts through the approval
 * queue when the rules match. Documented shape:
 *
 * ```ts
 * metadata.approvalRules?: {
 *   /** Catch-all — every scheduled post on this brand routes through approval. * /
 *   requireApprovalForPosts?: boolean;
 *   /** Approve when ANY selected target's platform is in the list. * /
 *   requireApprovalForPostsOnPlatforms?: PlatformCode[];
 *   /** Approve when the post's campaign.goal matches one of these. * /
 *   requireApprovalForCampaignTypes?: CampaignGoal[];
 * }
 * ```
 *
 * Default Phase 6: `requireApprovalForPosts = false` (no rules
 * active for seed orgs). There is NO UI to edit this in Phase 6 —
 * Settings > Brand Voice lands in Phase 7.
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
    /**
     * Free-form extension blob. See the JSDoc above for the
     * `metadata.approvalRules` shape used by the publishing flow
     * (Commit 19c.3, D-19-1). Added by migration 0008.
     */
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index('brand_voices_org_idx').on(table.organizationId),
  }),
);

export type BrandVoice = typeof brandVoices.$inferSelect;
export type NewBrandVoice = typeof brandVoices.$inferInsert;
