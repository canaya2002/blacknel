/**
 * The three Blacknel plans. **Source of truth for prices, limits and
 * feature availability.** `scripts/seed.ts` imports from here to populate
 * the `plans` table; gating code (`./gating.ts`) reads it to answer
 * "does this org get feature X?".
 *
 * Never inline plan data anywhere else. If you need to add a feature
 * flag, add it to `PlanFeatures` here, fill the value for all three
 * plans, then update the seed (it inserts whatever this exports).
 */

import type { PlatformCode } from '../connectors/types';

export type PlanCode = 'standard' | 'growth' | 'enterprise';

export interface PlanLimits {
  /** `-1` means unlimited. */
  brands: number;
  users: number;
  socialAccounts: number;
  locations: number;
  postsPerMonth: number;
}

/** Granularity that a feature is available at, when not a plain boolean. */
export type FeatureTier = 'basic' | 'standard' | 'advanced';

export interface PlanFeatures {
  /** Connector platforms enabled for this plan. */
  networks: ReadonlyArray<PlatformCode>;
  ai: FeatureTier;
  listening: false | FeatureTier;
  competitors: false | FeatureTier;
  ads: boolean;
  reports: FeatureTier;
  approvals: boolean;
  audit: false | FeatureTier;
  nps: false | FeatureTier;
  crisis: false | FeatureTier;
  reportBuilder: boolean;
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  priceCents: number;
  limits: PlanLimits;
  features: PlanFeatures;
}

export type FeatureKey = keyof PlanFeatures;
export type LimitMetric = keyof PlanLimits;

export const PLANS = {
  standard: {
    code: 'standard',
    name: 'Standard',
    priceCents: 6900,
    limits: {
      brands: 1,
      users: 3,
      socialAccounts: 5,
      locations: 1,
      postsPerMonth: 30,
    },
    features: {
      networks: ['facebook', 'instagram', 'gbp'],
      ai: 'basic',
      listening: false,
      competitors: false,
      ads: false,
      reports: 'basic',
      approvals: false,
      audit: false,
      nps: false,
      crisis: false,
      reportBuilder: false,
    },
  },
  growth: {
    code: 'growth',
    name: 'Growth',
    priceCents: 29900,
    limits: {
      brands: 3,
      users: 10,
      socialAccounts: 20,
      locations: 5,
      postsPerMonth: 250,
    },
    features: {
      networks: ['facebook', 'instagram', 'gbp', 'whatsapp', 'tiktok', 'linkedin'],
      ai: 'standard',
      listening: 'basic',
      competitors: 'basic',
      ads: false,
      reports: 'standard',
      approvals: true,
      audit: 'basic',
      nps: 'basic',
      crisis: 'basic',
      reportBuilder: false,
    },
  },
  enterprise: {
    code: 'enterprise',
    name: 'Enterprise',
    priceCents: 109900,
    limits: {
      brands: -1,
      users: -1,
      socialAccounts: 75,
      locations: 25,
      postsPerMonth: -1,
    },
    features: {
      networks: [
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
      ],
      ai: 'advanced',
      listening: 'advanced',
      competitors: 'advanced',
      ads: true,
      reports: 'advanced',
      approvals: true,
      audit: 'advanced',
      nps: 'advanced',
      crisis: 'advanced',
      reportBuilder: true,
    },
  },
} as const satisfies Record<PlanCode, PlanDefinition>;

export const PLAN_CODES: ReadonlyArray<PlanCode> = ['standard', 'growth', 'enterprise'];

export function getPlan(code: PlanCode): PlanDefinition {
  return PLANS[code];
}
