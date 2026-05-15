import type { PlatformCode } from '../connectors/types';
import { AppError } from '../errors';

import { type FeatureKey, type FeatureTier, getPlan, type PlanCode } from './plans';

/**
 * Boolean gates for feature availability per plan.
 *
 * `planAllowsFeature` returns true when the feature is enabled at any
 * tier (the caller can branch on `getPlan(code).features[key]` if they
 * need the specific tier — `'basic'` vs `'advanced'` etc.).
 */
export function planAllowsFeature(code: PlanCode, feature: FeatureKey): boolean {
  const value = getPlan(code).features[feature];
  if (value === false) return false;
  if (value === undefined) return false;
  return true;
}

/** Returns the feature tier (`'basic' | 'standard' | 'advanced'`) or null. */
export function planFeatureTier(code: PlanCode, feature: FeatureKey): FeatureTier | null {
  const value = getPlan(code).features[feature];
  if (typeof value === 'string') return value as FeatureTier;
  return null;
}

export function planAllowsPlatform(code: PlanCode, platform: PlatformCode): boolean {
  return getPlan(code).features.networks.includes(platform);
}

/**
 * Hard guard for Server Actions / Route Handlers. Throws a typed
 * `AppError('FEATURE_NOT_AVAILABLE_ON_PLAN')` the UI maps to the
 * upgrade prompt. Use at the top of any handler whose work is gated.
 *
 * NOTE: the org-id parameter is accepted for symmetry with the future
 * (Phase 10) per-org override system. For Phase 1 the gate is global —
 * the resolver in `checkLimit` / future helpers will read the org's
 * plan from the DB.
 */
export function requireFeature(planCode: PlanCode, feature: FeatureKey): void {
  if (!planAllowsFeature(planCode, feature)) {
    throw new AppError(
      'FEATURE_NOT_AVAILABLE_ON_PLAN',
      `Feature "${String(feature)}" is not included in the ${planCode} plan.`,
      { meta: { plan: planCode, feature } },
    );
  }
}

export function requirePlatform(planCode: PlanCode, platform: PlatformCode): void {
  if (!planAllowsPlatform(planCode, platform)) {
    throw new AppError(
      'FEATURE_NOT_AVAILABLE_ON_PLAN',
      `Platform "${platform}" is not included in the ${planCode} plan.`,
      { meta: { plan: planCode, platform } },
    );
  }
}
