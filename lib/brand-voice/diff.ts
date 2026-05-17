import type { ApprovalRules } from './validate';

/**
 * Approval-rules diff (Commit 26 / Ajuste 2).
 *
 * The audit event `brand_voice.approval_rules.changed` must
 * capture WHAT changed, not just THAT something changed. The
 * production question "¿por qué desde ayer Instagram requiere
 * aprobación?" needs to land on a single audit row.
 *
 * Diff shape:
 *
 *   {
 *     requireApprovalForPostsChanged?: { from, to } | undefined,
 *     addedPlatforms: PlatformCode[],
 *     removedPlatforms: PlatformCode[],
 *     addedGoals: CampaignGoal[],
 *     removedGoals: CampaignGoal[],
 *   }
 *
 * When NO field changed (caller submitted identical rules), the
 * diff is reported as `null` so the Server Action can skip
 * emitting the audit row entirely.
 */

export interface ApprovalRulesDiff {
  readonly requireApprovalForPostsChanged: { from: boolean; to: boolean } | null;
  readonly addedPlatforms: ReadonlyArray<string>;
  readonly removedPlatforms: ReadonlyArray<string>;
  readonly addedGoals: ReadonlyArray<string>;
  readonly removedGoals: ReadonlyArray<string>;
}

export function diffApprovalRules(
  before: ApprovalRules,
  after: ApprovalRules,
): ApprovalRulesDiff | null {
  const requireChanged =
    before.requireApprovalForPosts !== after.requireApprovalForPosts
      ? {
          from: before.requireApprovalForPosts,
          to: after.requireApprovalForPosts,
        }
      : null;

  const beforePlatforms = new Set(before.requireApprovalForPostsOnPlatforms);
  const afterPlatforms = new Set(after.requireApprovalForPostsOnPlatforms);
  const addedPlatforms = [...afterPlatforms].filter((p) => !beforePlatforms.has(p));
  const removedPlatforms = [...beforePlatforms].filter(
    (p) => !afterPlatforms.has(p),
  );

  const beforeGoals = new Set(before.requireApprovalForCampaignTypes);
  const afterGoals = new Set(after.requireApprovalForCampaignTypes);
  const addedGoals = [...afterGoals].filter((g) => !beforeGoals.has(g));
  const removedGoals = [...beforeGoals].filter((g) => !afterGoals.has(g));

  // No-change short-circuit. Caller skips audit emission entirely.
  if (
    !requireChanged &&
    addedPlatforms.length === 0 &&
    removedPlatforms.length === 0 &&
    addedGoals.length === 0 &&
    removedGoals.length === 0
  ) {
    return null;
  }

  return {
    requireApprovalForPostsChanged: requireChanged,
    addedPlatforms,
    removedPlatforms,
    addedGoals,
    removedGoals,
  };
}
