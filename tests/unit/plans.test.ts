import { describe, expect, it } from 'vitest';

import { AppError } from '../../lib/errors';
import {
  planAllowsFeature,
  planAllowsPlatform,
  planFeatureTier,
  requireFeature,
  requirePlatform,
} from '../../lib/plans/gating';
import {
  fitsLimit,
  getPlanLimit,
  requireLimit,
} from '../../lib/plans/limits';
import { PLAN_CODES, PLANS, getPlan } from '../../lib/plans/plans';

describe('PLANS catalog', () => {
  it('exposes the three canonical plans', () => {
    expect(PLAN_CODES).toEqual(['standard', 'growth', 'enterprise']);
    expect(Object.keys(PLANS).sort()).toEqual(['enterprise', 'growth', 'standard']);
  });

  it('keeps the contractual prices', () => {
    expect(PLANS.standard.priceCents).toBe(6900);
    expect(PLANS.growth.priceCents).toBe(29900);
    expect(PLANS.enterprise.priceCents).toBe(109900);
  });

  it('keeps the contractual hard limits per plan', () => {
    expect(PLANS.standard.limits).toMatchObject({
      brands: 1,
      users: 3,
      socialAccounts: 5,
      locations: 1,
      postsPerMonth: 30,
    });
    expect(PLANS.growth.limits).toMatchObject({
      brands: 3,
      users: 10,
      socialAccounts: 20,
      locations: 5,
      postsPerMonth: 250,
    });
    expect(PLANS.enterprise.limits).toMatchObject({
      brands: -1,
      users: -1,
      socialAccounts: 75,
      locations: 25,
      postsPerMonth: -1,
    });
  });
});

describe('planAllowsFeature()', () => {
  it('standard plan does not include listening or ads', () => {
    expect(planAllowsFeature('standard', 'listening')).toBe(false);
    expect(planAllowsFeature('standard', 'ads')).toBe(false);
    expect(planAllowsFeature('standard', 'approvals')).toBe(false);
    expect(planAllowsFeature('standard', 'reportBuilder')).toBe(false);
  });

  it('growth plan unlocks approvals and basic listening', () => {
    expect(planAllowsFeature('growth', 'approvals')).toBe(true);
    expect(planAllowsFeature('growth', 'listening')).toBe(true);
    expect(planFeatureTier('growth', 'listening')).toBe('basic');
    expect(planAllowsFeature('growth', 'ads')).toBe(false);
    expect(planAllowsFeature('growth', 'reportBuilder')).toBe(false);
  });

  it('enterprise unlocks everything including ads and report builder', () => {
    expect(planAllowsFeature('enterprise', 'ads')).toBe(true);
    expect(planAllowsFeature('enterprise', 'reportBuilder')).toBe(true);
    expect(planFeatureTier('enterprise', 'listening')).toBe('advanced');
    expect(planFeatureTier('enterprise', 'crisis')).toBe('advanced');
  });
});

describe('planAllowsPlatform()', () => {
  it('standard includes facebook, instagram and gbp only', () => {
    expect(planAllowsPlatform('standard', 'facebook')).toBe(true);
    expect(planAllowsPlatform('standard', 'instagram')).toBe(true);
    expect(planAllowsPlatform('standard', 'gbp')).toBe(true);
    expect(planAllowsPlatform('standard', 'whatsapp')).toBe(false);
    expect(planAllowsPlatform('standard', 'tiktok')).toBe(false);
  });

  it('growth adds whatsapp, tiktok, linkedin', () => {
    expect(planAllowsPlatform('growth', 'whatsapp')).toBe(true);
    expect(planAllowsPlatform('growth', 'tiktok')).toBe(true);
    expect(planAllowsPlatform('growth', 'linkedin')).toBe(true);
    expect(planAllowsPlatform('growth', 'yelp')).toBe(false);
  });

  it('enterprise covers every platform in the connector catalog', () => {
    for (const platform of [
      'facebook',
      'instagram',
      'gbp',
      'whatsapp',
      'tiktok',
      'linkedin',
      'x',
      'youtube',
      'pinterest',
      'reddit',
      'yelp',
      'tripadvisor',
      'trustpilot',
      'bbb',
      'avvo',
    ] as const) {
      expect(planAllowsPlatform('enterprise', platform)).toBe(true);
    }
  });
});

describe('requireFeature() / requirePlatform()', () => {
  it('does not throw when the plan includes the feature', () => {
    expect(() => requireFeature('growth', 'approvals')).not.toThrow();
  });

  it('throws FEATURE_NOT_AVAILABLE_ON_PLAN when the plan lacks the feature', () => {
    expect(() => requireFeature('standard', 'ads')).toThrow(AppError);
    try {
      requireFeature('standard', 'ads');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe('FEATURE_NOT_AVAILABLE_ON_PLAN');
      expect(appErr.httpStatus).toBe(403);
      expect(appErr.meta).toMatchObject({ plan: 'standard', feature: 'ads' });
    }
  });

  it('requirePlatform throws on standard for whatsapp', () => {
    expect(() => requirePlatform('standard', 'whatsapp')).toThrow(AppError);
  });
});

describe('limits', () => {
  it('getPlanLimit returns the configured value, -1 for unlimited', () => {
    expect(getPlanLimit('standard', 'postsPerMonth')).toBe(30);
    expect(getPlanLimit('growth', 'postsPerMonth')).toBe(250);
    expect(getPlanLimit('enterprise', 'postsPerMonth')).toBe(-1);
    expect(getPlanLimit('enterprise', 'brands')).toBe(-1);
  });

  it('fitsLimit treats -1 as unlimited', () => {
    expect(fitsLimit('enterprise', 'postsPerMonth', 9999, 1)).toBe(true);
    expect(fitsLimit('enterprise', 'brands', 50, 1)).toBe(true);
  });

  it('fitsLimit blocks adding when the next +1 exceeds the cap', () => {
    expect(fitsLimit('standard', 'socialAccounts', 4, 1)).toBe(true); // 5/5
    expect(fitsLimit('standard', 'socialAccounts', 5, 1)).toBe(false); // 6/5
    expect(fitsLimit('growth', 'postsPerMonth', 249, 1)).toBe(true);
    expect(fitsLimit('growth', 'postsPerMonth', 250, 1)).toBe(false);
  });

  it('requireLimit throws PLAN_LIMIT_REACHED with meta', () => {
    expect(() =>
      requireLimit('standard', 'socialAccounts', 5, 1),
    ).toThrow(AppError);
    try {
      requireLimit('standard', 'socialAccounts', 5, 1);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe('PLAN_LIMIT_REACHED');
      expect(appErr.httpStatus).toBe(429);
      expect(appErr.meta).toMatchObject({
        plan: 'standard',
        metric: 'socialAccounts',
        current: 5,
        delta: 1,
        cap: 5,
      });
    }
  });
});

describe('getPlan()', () => {
  it('returns plan definitions intact', () => {
    expect(getPlan('standard').code).toBe('standard');
    expect(getPlan('growth').name).toBe('Growth');
    expect(getPlan('enterprise').features.networks.length).toBeGreaterThan(10);
  });
});
