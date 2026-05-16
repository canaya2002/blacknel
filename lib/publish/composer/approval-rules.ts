import type { CampaignGoal } from '@/lib/ai/caption-stub';
import type { PlatformCode } from '@/lib/connectors/base';

/**
 * Approval rules evaluator (Commit 19c.3, D-19-1).
 *
 * Reads the documented `metadata.approvalRules` shape on a brand
 * voice and returns whether a scheduled / publish-now action
 * should route through the approval queue.
 *
 * Pure — no DB access, no side effects. The caller (`applySchedule`
 * in `apply-schedule.ts`) fetches `brand_voices.metadata` +
 * `campaign.goal` + selected target platforms, then hands them to
 * this function.
 *
 * # Three rule sources, OR-combined
 *
 *   1. **`requireApprovalForPosts: true`** — catch-all. Any
 *      scheduled / publish-now action routes through approval.
 *   2. **`requireApprovalForPostsOnPlatforms`** — if at least one
 *      target platform is in the list, route. Empty list / missing
 *      key = doesn't fire.
 *   3. **`requireApprovalForCampaignTypes`** — if the post's
 *      campaign goal is in the list, route. No campaign / not in
 *      list = doesn't fire.
 *
 * The `reason` returned reflects the FIRST rule that fired (1 > 2 >
 * 3). The audit log uses it; UI can surface it as a tooltip.
 */

export interface ApprovalRules {
  readonly requireApprovalForPosts?: boolean;
  readonly requireApprovalForPostsOnPlatforms?: ReadonlyArray<PlatformCode>;
  readonly requireApprovalForCampaignTypes?: ReadonlyArray<CampaignGoal>;
}

export type ApprovalReason =
  | 'brand_rule'
  | 'platform_rule'
  | 'campaign_rule';

export interface ApprovalDecision {
  readonly required: boolean;
  readonly reason: ApprovalReason | null;
  /** When `reason === 'platform_rule'`, the platforms that matched. */
  readonly matchedPlatforms: ReadonlyArray<PlatformCode>;
  /** When `reason === 'campaign_rule'`, the campaign goal that matched. */
  readonly matchedCampaignGoal: CampaignGoal | null;
}

export interface EvaluateApprovalRulesInput {
  readonly rules: ApprovalRules | null | undefined;
  readonly targetPlatforms: ReadonlyArray<PlatformCode>;
  readonly campaignGoal: CampaignGoal | null;
}

const EMPTY_DECISION: ApprovalDecision = {
  required: false,
  reason: null,
  matchedPlatforms: [],
  matchedCampaignGoal: null,
};

export function evaluateApprovalRules(
  input: EvaluateApprovalRulesInput,
): ApprovalDecision {
  const rules = input.rules;
  if (!rules) return EMPTY_DECISION;

  // Rule 1 — catch-all.
  if (rules.requireApprovalForPosts === true) {
    return {
      required: true,
      reason: 'brand_rule',
      matchedPlatforms: [],
      matchedCampaignGoal: null,
    };
  }

  // Rule 2 — platform allow-list.
  if (
    rules.requireApprovalForPostsOnPlatforms &&
    rules.requireApprovalForPostsOnPlatforms.length > 0 &&
    input.targetPlatforms.length > 0
  ) {
    const rulePlatforms = new Set<string>(
      rules.requireApprovalForPostsOnPlatforms,
    );
    const matched = input.targetPlatforms.filter((p) => rulePlatforms.has(p));
    if (matched.length > 0) {
      return {
        required: true,
        reason: 'platform_rule',
        matchedPlatforms: matched,
        matchedCampaignGoal: null,
      };
    }
  }

  // Rule 3 — campaign goal.
  if (
    rules.requireApprovalForCampaignTypes &&
    rules.requireApprovalForCampaignTypes.length > 0 &&
    input.campaignGoal !== null
  ) {
    const ruleGoals = new Set<CampaignGoal>(rules.requireApprovalForCampaignTypes);
    if (ruleGoals.has(input.campaignGoal)) {
      return {
        required: true,
        reason: 'campaign_rule',
        matchedPlatforms: [],
        matchedCampaignGoal: input.campaignGoal,
      };
    }
  }

  return EMPTY_DECISION;
}

/**
 * Defensive parser. The `metadata` jsonb is loosely typed at the DB
 * boundary; this normalizer drops anything that doesn't match the
 * documented shape. Returns `null` when no rules are present.
 */
export function parseApprovalRules(raw: unknown): ApprovalRules | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const blob = obj.approvalRules;
  if (!blob || typeof blob !== 'object') return null;
  const r = blob as Record<string, unknown>;

  const out: {
    requireApprovalForPosts?: boolean;
    requireApprovalForPostsOnPlatforms?: PlatformCode[];
    requireApprovalForCampaignTypes?: CampaignGoal[];
  } = {};

  if (typeof r.requireApprovalForPosts === 'boolean') {
    out.requireApprovalForPosts = r.requireApprovalForPosts;
  }
  if (Array.isArray(r.requireApprovalForPostsOnPlatforms)) {
    out.requireApprovalForPostsOnPlatforms = r.requireApprovalForPostsOnPlatforms.filter(
      (p): p is PlatformCode => typeof p === 'string',
    ) as PlatformCode[];
  }
  if (Array.isArray(r.requireApprovalForCampaignTypes)) {
    out.requireApprovalForCampaignTypes = r.requireApprovalForCampaignTypes.filter(
      (g): g is CampaignGoal => typeof g === 'string',
    ) as CampaignGoal[];
  }

  // If nothing parsed, behave like "no rules".
  if (
    out.requireApprovalForPosts === undefined &&
    !out.requireApprovalForPostsOnPlatforms?.length &&
    !out.requireApprovalForCampaignTypes?.length
  ) {
    return null;
  }
  return out;
}
