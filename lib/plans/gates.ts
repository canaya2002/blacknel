/**
 * Phase 9 / Commit 31 — named gates for Growth-tier features.
 *
 * Thin facade over `lib/plans/gating.ts` so Phase-9 Server
 * Actions speak the same vocabulary the product spec uses
 * (`'whatsapp_business'`, `'nps_surveys'`, …) instead of the
 * lower-level `PlanFeatures` keys. Each gate maps to either a
 * platform check (`requirePlatform`) or a feature-key check
 * (`requireFeature`); the choice depends on where the existing
 * matrix already represents it.
 *
 * Error semantics (preserved from existing infrastructure):
 *
 *   - Standard plan tries to connect WhatsApp →
 *     `FEATURE_NOT_AVAILABLE_ON_PLAN` (HTTP 403). This is the
 *     correct code per `lib/errors.ts` — "your plan doesn't
 *     include this at all" is distinct from
 *     `PLAN_LIMIT_REACHED` (HTTP 429), which is for capacity
 *     caps you've exhausted.
 *
 *   - Caller wraps the call: the action gets a typed throw it
 *     can re-throw, or maps to an `err('FEATURE_NOT_AVAILABLE_ON_PLAN',
 *     …)` Result if it prefers the soft path. The UI shows the
 *     `<UpgradePrompt />` overlay either way.
 */

import { AppError } from '../errors';

import { type PlanCode } from './plans';
import { planAllowsFeature, planAllowsPlatform, requireFeature, requirePlatform } from './gating';

/**
 * The product-facing Growth-tier feature names. Each maps under
 * the hood to either a platform or a `PlanFeatures` key already
 * defined in `lib/plans/plans.ts`. Adding a new feature here
 * means either:
 *
 *   1. Extending `PlanFeatures` in plans.ts (preferred — keeps
 *      the matrix authoritative).
 *   2. Or, for platform-gated features (like `whatsapp_business`),
 *      mapping to a platform code that's already in `networks`.
 */
export type PlanFeature =
  | 'whatsapp_business'
  | 'nps_surveys'
  | 'listening_mentions'
  | 'competitors_tracking'
  | 'scheduled_report_emails'
  | 'ads_intelligence';

// Map each named feature to its underlying gating predicate.
function evaluate(plan: PlanCode, feature: PlanFeature): boolean {
  switch (feature) {
    case 'whatsapp_business':
      return planAllowsPlatform(plan, 'whatsapp');
    case 'nps_surveys':
      return planAllowsFeature(plan, 'nps');
    case 'listening_mentions':
      return planAllowsFeature(plan, 'listening');
    case 'competitors_tracking':
      return planAllowsFeature(plan, 'competitors');
    case 'ads_intelligence':
      return planAllowsFeature(plan, 'ads');
    case 'scheduled_report_emails':
      // Phase-9-introduced concept that has no current
      // `PlanFeatures` key. Available on Growth+; Standard
      // plan stays read-only until upgrade. When Commit 34
      // lands we'll add a `scheduledReports` key to
      // `PlanFeatures` and switch to it.
      return plan === 'growth' || plan === 'enterprise';
  }
}

export function planAllowsNamedFeature(
  plan: PlanCode,
  feature: PlanFeature,
): boolean {
  return evaluate(plan, feature);
}

/**
 * Hard guard for Server Actions. Throws
 * `FEATURE_NOT_AVAILABLE_ON_PLAN` via the underlying
 * `requirePlatform` / `requireFeature` helpers.
 */
export function requirePlanFeature(
  plan: PlanCode,
  feature: PlanFeature,
): void {
  switch (feature) {
    case 'whatsapp_business':
      requirePlatform(plan, 'whatsapp');
      return;
    case 'nps_surveys':
      requireFeature(plan, 'nps');
      return;
    case 'listening_mentions':
      requireFeature(plan, 'listening');
      return;
    case 'competitors_tracking':
      requireFeature(plan, 'competitors');
      return;
    case 'ads_intelligence':
      requireFeature(plan, 'ads');
      return;
    case 'scheduled_report_emails':
      if (!evaluate(plan, feature)) {
        // Hand-rolled throw since there's no underlying matrix
        // key yet. Same error code so UI maps consistently.
        throw new AppError(
          'FEATURE_NOT_AVAILABLE_ON_PLAN',
          `Feature "${feature}" is not included in the ${plan} plan.`,
          { meta: { plan, feature } },
        );
      }
      return;
  }
}
