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
  /**
   * Monthly cap on outbound review-request emails (Commit 16). Window
   * is the calendar month; counter rolls forward like
   * `postsPerMonth`. Enforced by `lib/reviews/send-request.ts` via
   * `checkUsage(...)` before each insert. `-1` is unlimited.
   */
  reviewRequestsPerMonth: number;
  /**
   * Maximum size in bytes for a single uploaded asset (Commit 19b).
   * Enforced at upload time both client-side (early feedback) and
   * server-side (defense in depth). `-1` would mean unlimited but
   * no plan declares that today — every tier caps the single-file
   * size so a runaway upload can't fill storage on its own.
   */
  maxAssetSizeBytes: number;
  /**
   * Maximum number of assets retained in the org library
   * (Commit 19b). Point-in-time counter (`assetsInLibrary`),
   * incremented on upload, decremented on delete. `-1` is
   * unlimited (Enterprise).
   */
  assetsInLibrary: number;
  /**
   * Cap (in bytes) on the org's cumulative asset library storage
   * (Commit 19b). Tracked as a point-in-time counter under the
   * same key — incremented by file size on upload, decremented
   * on delete. `-1` is unlimited (Enterprise). When
   * `assetsInLibrary × maxAssetSizeBytes` would exceed this,
   * storage becomes the binding constraint.
   *
   * Naming follows the established convention (`postsPerMonth`,
   * `brands`, etc.) — the field name doubles as both the cap key
   * in PlanLimits and the metric name in `usage_counters`.
   */
  storageBytes: number;
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
      reviewRequestsPerMonth: 50,
      maxAssetSizeBytes: 5_000_000, // 5 MB
      assetsInLibrary: 100,
      storageBytes: 500_000_000, // 500 MB total
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
      reviewRequestsPerMonth: 250,
      maxAssetSizeBytes: 25_000_000, // 25 MB
      assetsInLibrary: 500,
      storageBytes: 15_000_000_000, // 15 GB total
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
      reviewRequestsPerMonth: -1,
      maxAssetSizeBytes: 100_000_000, // 100 MB
      assetsInLibrary: -1,
      storageBytes: -1, // unlimited
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
