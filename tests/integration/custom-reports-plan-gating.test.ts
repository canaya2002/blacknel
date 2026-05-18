import { describe, expect, it } from 'vitest';

import {
  planAllowsNamedFeature,
  requirePlanFeature,
} from '../../lib/plans/gates';
import { PLANS } from '../../lib/plans/plans';

/**
 * Phase 10 / Commit 39 — plan gating defense-in-depth.
 *
 * Verifies the gate is wired everywhere it needs to be:
 *
 *   1. PlanFeatures.customReports — Standard/Growth false,
 *      Enterprise true.
 *   2. maxCustomReportsPerOrg — Standard/Growth 0, Enterprise 50.
 *   3. requirePlanFeature throws FEATURE_NOT_AVAILABLE_ON_PLAN
 *      for Standard/Growth.
 */

describe('custom_reports plan gate', () => {
  it('PlanFeatures.customReports — only Enterprise', () => {
    expect(PLANS.standard.features.customReports).toBe(false);
    expect(PLANS.growth.features.customReports).toBe(false);
    expect(PLANS.enterprise.features.customReports).toBe(true);
  });

  it('maxCustomReportsPerOrg — Standard/Growth 0, Enterprise 50', () => {
    expect(PLANS.standard.limits.maxCustomReportsPerOrg).toBe(0);
    expect(PLANS.growth.limits.maxCustomReportsPerOrg).toBe(0);
    expect(PLANS.enterprise.limits.maxCustomReportsPerOrg).toBe(50);
  });

  it('planAllowsNamedFeature returns expected truth across all 3 plans', () => {
    expect(planAllowsNamedFeature('standard', 'custom_reports')).toBe(false);
    expect(planAllowsNamedFeature('growth', 'custom_reports')).toBe(false);
    expect(planAllowsNamedFeature('enterprise', 'custom_reports')).toBe(true);
  });

  it('requirePlanFeature throws for Standard, Growth and passes for Enterprise', () => {
    expect(() => requirePlanFeature('standard', 'custom_reports')).toThrow();
    expect(() => requirePlanFeature('growth', 'custom_reports')).toThrow();
    expect(() =>
      requirePlanFeature('enterprise', 'custom_reports'),
    ).not.toThrow();
  });
});
