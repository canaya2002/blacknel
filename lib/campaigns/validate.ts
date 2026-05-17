import { z } from 'zod';

/**
 * Validation primitives for campaign CRUD (Commit 21).
 *
 * Two layers:
 *
 *   1. `canTransitionCampaignStatus(from, to)` — pure function
 *      encoding the lifecycle graph. The Server Action
 *      `transitionCampaignStatusAction` is the only call site that
 *      should consult this gate (it runs server-side under auth +
 *      RLS). Tests cover the full positive + negative matrix.
 *
 *   2. Zod schemas — `createCampaignSchema` / `updateCampaignSchema`
 *      / `transitionCampaignStatusSchema` / `setPostCampaignSchema`
 *      / `updateManualSpentSchema`. Cross-field validation
 *      (e.g. `startsAt < endsAt`) lives in `.superRefine` so the
 *      error surfaces under the right field on the form.
 *
 * The transition graph mirrors the JSDoc on `campaignStatusEnum`
 * in `lib/db/schema/_enums.ts`. Keep both in sync.
 */

export type CampaignStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';

export type CampaignGoal =
  | 'awareness'
  | 'engagement'
  | 'leads'
  | 'reviews'
  | 'reputation'
  | 'event'
  | 'launch'
  | 'promotion'
  | 'education'
  | 'crisis'
  | 'seasonal'
  | 'evergreen';

export const CAMPAIGN_STATUSES: ReadonlyArray<CampaignStatus> = [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
];

export const CAMPAIGN_GOALS: ReadonlyArray<CampaignGoal> = [
  'awareness',
  'engagement',
  'leads',
  'reviews',
  'reputation',
  'event',
  'launch',
  'promotion',
  'education',
  'crisis',
  'seasonal',
  'evergreen',
];

// ---------------------------------------------------------------------------
// Status transition graph
// ---------------------------------------------------------------------------

const ALLOWED_CAMPAIGN_TRANSITIONS: Readonly<
  Record<CampaignStatus, ReadonlyArray<CampaignStatus>>
> = {
  draft: ['active', 'archived'],
  active: ['paused', 'completed'],
  paused: ['active', 'archived'],
  completed: ['archived'],
  archived: [],
};

/**
 * Pure-function gate for `campaign.status` transitions. Returns
 * `false` for any self-transition (`from === to`) and for any
 * edge not in the allow-list. The Server Action consults this
 * BEFORE issuing the UPDATE so a disallowed edge fails as
 * VALIDATION_ERROR instead of corrupting the lifecycle.
 *
 * See `campaignStatusEnum` JSDoc for the graph rationale.
 */
export function canTransitionCampaignStatus(
  from: CampaignStatus,
  to: CampaignStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED_CAMPAIGN_TRANSITIONS[from].includes(to);
}

/** Returns the allowed next states from `from`. Drives the UI dropdown. */
export function allowedCampaignTransitionsFrom(
  from: CampaignStatus,
): ReadonlyArray<CampaignStatus> {
  return ALLOWED_CAMPAIGN_TRANSITIONS[from];
}

/** True when no further transition exists. Used by the UI to hide controls. */
export function isCampaignStatusTerminal(status: CampaignStatus): boolean {
  return ALLOWED_CAMPAIGN_TRANSITIONS[status].length === 0;
}

// ---------------------------------------------------------------------------
// Zod — create
// ---------------------------------------------------------------------------

const goalSchema = z.enum([
  'awareness',
  'engagement',
  'leads',
  'reviews',
  'reputation',
  'event',
  'launch',
  'promotion',
  'education',
  'crisis',
  'seasonal',
  'evergreen',
]);

/**
 * Create-time shape. `startsAt < endsAt` AND `endsAt > now` are
 * cross-field invariants; both surface as field-level Zod errors
 * via `.superRefine` so the form can highlight the offending input.
 */
export const createCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    brandId: z.string().uuid().nullable().optional(),
    goal: goalSchema.default('evergreen'),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    budgetCents: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.startsAt && data.endsAt && data.startsAt >= data.endsAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'La fecha de fin debe ser posterior a la de inicio.',
      });
    }
    // `endsAt <= now` is rejected on create — the rule lets you
    // create a campaign that already started (a back-fill is
    // legitimate when documenting a campaign that ran offline),
    // but a campaign that already ended makes no sense to create.
    if (data.endsAt && data.endsAt.getTime() <= Date.now()) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'No se puede crear una campaña que ya terminó.',
      });
    }
  });

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

// ---------------------------------------------------------------------------
// Zod — update (every field optional; same cross-field invariants if both present)
// ---------------------------------------------------------------------------

export const updateCampaignSchema = z
  .object({
    campaignId: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    brandId: z.string().uuid().nullable().optional(),
    goal: goalSchema.optional(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    budgetCents: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.startsAt && data.endsAt && data.startsAt >= data.endsAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'La fecha de fin debe ser posterior a la de inicio.',
      });
    }
  });

export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

// ---------------------------------------------------------------------------
// Zod — status transition
// ---------------------------------------------------------------------------

const campaignStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
]);

export const transitionCampaignStatusSchema = z
  .object({
    campaignId: z.string().uuid(),
    to: campaignStatusSchema,
  })
  .strict();

export type TransitionCampaignStatusInput = z.infer<
  typeof transitionCampaignStatusSchema
>;

// ---------------------------------------------------------------------------
// Zod — composer wire (post ↔ campaign)
// ---------------------------------------------------------------------------

export const setPostCampaignSchema = z
  .object({
    postId: z.string().uuid(),
    /** null detaches the post from any campaign. */
    campaignId: z.string().uuid().nullable(),
  })
  .strict();

export type SetPostCampaignInput = z.infer<typeof setPostCampaignSchema>;

// ---------------------------------------------------------------------------
// Zod — manual spent (Phase-8 placeholder; lives in metadata.manualSpentCents)
// ---------------------------------------------------------------------------

export const updateManualSpentSchema = z
  .object({
    campaignId: z.string().uuid(),
    /**
     * Manual entry in cents. Phase 6 stores this in
     * `campaigns.metadata.manualSpentCents`; Phase 8 replaces with
     * a real spent calculation derived from connected ad accounts.
     */
    manualSpentCents: z.number().int().min(0).max(10_000_000_000),
  })
  .strict();

export type UpdateManualSpentInput = z.infer<typeof updateManualSpentSchema>;
