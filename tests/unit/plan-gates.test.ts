import { describe, expect, it } from 'vitest';

import {
  planAllowsNamedFeature,
  requirePlanFeature,
  type PlanFeature,
} from '../../lib/plans/gates';

/**
 * Phase 9 / Commit 31 — facade gates matrix correctness.
 *
 * Each named PlanFeature maps under the hood to either a
 * platform (`whatsapp` → 'whatsapp_business') or a
 * PlanFeatures key (`nps` → 'nps_surveys'). The matrix in
 * `lib/plans/plans.ts` is the source of truth; these tests
 * verify the facade resolves correctly.
 */

describe('planAllowsNamedFeature', () => {
  const cases: Array<{
    feature: PlanFeature;
    standard: boolean;
    growth: boolean;
    enterprise: boolean;
  }> = [
    { feature: 'whatsapp_business', standard: false, growth: true, enterprise: true },
    { feature: 'nps_surveys', standard: false, growth: true, enterprise: true },
    { feature: 'listening_mentions', standard: false, growth: true, enterprise: true },
    { feature: 'competitors_tracking', standard: false, growth: true, enterprise: true },
    { feature: 'scheduled_report_emails', standard: false, growth: true, enterprise: true },
    { feature: 'ads_intelligence', standard: false, growth: false, enterprise: true },
  ];

  for (const c of cases) {
    it(`${c.feature}: standard=${c.standard} growth=${c.growth} enterprise=${c.enterprise}`, () => {
      expect(planAllowsNamedFeature('standard', c.feature)).toBe(c.standard);
      expect(planAllowsNamedFeature('growth', c.feature)).toBe(c.growth);
      expect(planAllowsNamedFeature('enterprise', c.feature)).toBe(c.enterprise);
    });
  }
});

describe('requirePlanFeature', () => {
  it('throws for standard on every Growth-tier feature', () => {
    const growthFeatures: PlanFeature[] = [
      'whatsapp_business',
      'nps_surveys',
      'listening_mentions',
      'competitors_tracking',
      'scheduled_report_emails',
    ];
    for (const f of growthFeatures) {
      expect(() => requirePlanFeature('standard', f)).toThrow();
    }
  });

  it('does NOT throw for growth on Growth-tier features', () => {
    expect(() => requirePlanFeature('growth', 'whatsapp_business')).not.toThrow();
    expect(() => requirePlanFeature('growth', 'nps_surveys')).not.toThrow();
    expect(() =>
      requirePlanFeature('growth', 'scheduled_report_emails'),
    ).not.toThrow();
  });

  it('throws for growth on Enterprise-only ads_intelligence', () => {
    expect(() => requirePlanFeature('growth', 'ads_intelligence')).toThrow();
  });

  it('does NOT throw for enterprise on every feature', () => {
    const all: PlanFeature[] = [
      'whatsapp_business',
      'nps_surveys',
      'listening_mentions',
      'competitors_tracking',
      'scheduled_report_emails',
      'ads_intelligence',
    ];
    for (const f of all) {
      expect(() => requirePlanFeature('enterprise', f)).not.toThrow();
    }
  });
});
