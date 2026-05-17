import { describe, expect, it } from 'vitest';

import {
  generateReviewsForDay,
  type MockReview,
} from '../../lib/connectors/base/review-generator';
import {
  AvvoPlatformSpecificSchema,
  BbbPlatformSpecificSchema,
  TripadvisorPlatformSpecificSchema,
  TrustpilotPlatformSpecificSchema,
  YelpPlatformSpecificSchema,
  validatePlatformSpecific,
} from '../../lib/reviews/platform-specific-schemas';

/**
 * Phase 10 / Commit 38 — review-generator + Zod per-platform
 * schemas. Each generator output MUST validate against its
 * corresponding schema (defense in depth: the generator is the
 * data origin, the schemas are the validation boundary, and the
 * seed runs both).
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = 'enterprise-test-account';

describe('generateReviewsForDay — determinism', () => {
  it('same (orgId, accountId, day, platform) produces identical output across calls', () => {
    const a = generateReviewsForDay({
      orgId: ORG,
      accountId: ACCOUNT,
      day: '2026-05-15',
      platform: 'yelp',
    });
    const b = generateReviewsForDay({
      orgId: ORG,
      accountId: ACCOUNT,
      day: '2026-05-15',
      platform: 'yelp',
    });
    expect(b).toEqual(a);
  });

  it('different day → different output (high probability)', () => {
    const a = generateReviewsForDay({
      orgId: ORG,
      accountId: ACCOUNT,
      day: '2026-05-15',
      platform: 'trustpilot',
    });
    const b = generateReviewsForDay({
      orgId: ORG,
      accountId: ACCOUNT,
      day: '2026-05-16',
      platform: 'trustpilot',
    });
    // External IDs encode the day, so even if counts match the IDs
    // must differ.
    if (a.length > 0 && b.length > 0) {
      expect(a[0]!.externalId).not.toBe(b[0]!.externalId);
    }
  });
});

describe('generateReviewsForDay — volume bands per platform', () => {
  // Sample many seeds per platform to verify the band holds.
  const platforms = ['yelp', 'tripadvisor', 'trustpilot', 'bbb', 'avvo'] as const;
  const bands: Record<(typeof platforms)[number], [number, number]> = {
    yelp: [0, 5],
    tripadvisor: [1, 10],
    trustpilot: [2, 15],
    bbb: [0, 2],
    avvo: [0, 1],
  };

  for (const platform of platforms) {
    it(`${platform} stays within ${bands[platform][0]}..${bands[platform][1]} reviews/day`, () => {
      const [min, max] = bands[platform];
      for (let i = 0; i < 50; i += 1) {
        const day = `2026-05-${String((i % 28) + 1).padStart(2, '0')}`;
        const out = generateReviewsForDay({
          orgId: ORG,
          accountId: `${ACCOUNT}-${i}`,
          day,
          platform,
        });
        expect(out.length).toBeGreaterThanOrEqual(min);
        expect(out.length).toBeLessThanOrEqual(max);
      }
    });
  }
});

describe('generateReviewsForDay — BBB lifecycle (Ajuste 2)', () => {
  it('BBB rows have null rating, negative sentiment, and lifecycle fields', () => {
    let foundAny = false;
    for (let i = 0; i < 30; i += 1) {
      const out = generateReviewsForDay({
        orgId: ORG,
        accountId: `${ACCOUNT}-bbb-${i}`,
        day: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
        platform: 'bbb',
      });
      for (const r of out) {
        foundAny = true;
        expect(r.rating).toBeNull();
        expect(r.sentiment).toBe('negative');
        const ps = r.platformSpecific;
        expect(['pending', 'assigned', 'resolved', 'closed']).toContain(
          ps['complaint_status'],
        );
        expect([
          'product',
          'service',
          'billing',
          'advertising',
          'sales',
        ]).toContain(ps['complaint_type']);
        expect(typeof ps['case_id']).toBe('string');
        expect(ps['case_id']).toMatch(/^BBB-\d{8}-\d+$/);
      }
    }
    expect(foundAny).toBe(true);
  });
});

describe('generateReviewsForDay — platform_specific Zod validation', () => {
  it('Yelp rows pass YelpPlatformSpecificSchema', () => {
    for (let i = 0; i < 10; i += 1) {
      const out = generateReviewsForDay({
        orgId: ORG,
        accountId: ACCOUNT,
        day: `2026-05-${String(i + 1).padStart(2, '0')}`,
        platform: 'yelp',
      });
      for (const r of out) {
        expect(() => YelpPlatformSpecificSchema.parse(r.platformSpecific)).not.toThrow();
      }
    }
  });

  it('TripAdvisor rows pass TripadvisorPlatformSpecificSchema', () => {
    for (let i = 0; i < 10; i += 1) {
      const out = generateReviewsForDay({
        orgId: ORG,
        accountId: ACCOUNT,
        day: `2026-05-${String(i + 1).padStart(2, '0')}`,
        platform: 'tripadvisor',
      });
      for (const r of out) {
        expect(() =>
          TripadvisorPlatformSpecificSchema.parse(r.platformSpecific),
        ).not.toThrow();
      }
    }
  });

  it('Trustpilot rows pass TrustpilotPlatformSpecificSchema', () => {
    for (let i = 0; i < 10; i += 1) {
      const out = generateReviewsForDay({
        orgId: ORG,
        accountId: ACCOUNT,
        day: `2026-05-${String(i + 1).padStart(2, '0')}`,
        platform: 'trustpilot',
      });
      for (const r of out) {
        expect(() =>
          TrustpilotPlatformSpecificSchema.parse(r.platformSpecific),
        ).not.toThrow();
      }
    }
  });

  it('BBB rows pass BbbPlatformSpecificSchema', () => {
    for (let i = 0; i < 20; i += 1) {
      const out = generateReviewsForDay({
        orgId: ORG,
        accountId: ACCOUNT,
        day: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
        platform: 'bbb',
      });
      for (const r of out) {
        expect(() => BbbPlatformSpecificSchema.parse(r.platformSpecific)).not.toThrow();
      }
    }
  });

  it('Avvo rows pass AvvoPlatformSpecificSchema', () => {
    for (let i = 0; i < 30; i += 1) {
      const out = generateReviewsForDay({
        orgId: ORG,
        accountId: ACCOUNT,
        day: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
        platform: 'avvo',
      });
      for (const r of out) {
        expect(() => AvvoPlatformSpecificSchema.parse(r.platformSpecific)).not.toThrow();
      }
    }
  });
});

describe('validatePlatformSpecific — dispatcher', () => {
  it('returns null for null/undefined payloads on any platform', () => {
    expect(validatePlatformSpecific('yelp', null)).toBeNull();
    expect(validatePlatformSpecific('bbb', null)).toBeNull();
    expect(validatePlatformSpecific('avvo', undefined)).toBeNull();
  });

  it('passes through unknown/legacy platforms unchanged', () => {
    const payload = { legacy_field: 'anything' };
    expect(validatePlatformSpecific('facebook', payload)).toEqual(payload);
    expect(validatePlatformSpecific('instagram', payload)).toEqual(payload);
  });

  it('rejects unknown fields on Yelp (strict schema)', () => {
    expect(() =>
      validatePlatformSpecific('yelp', { totally_invalid_field: true }),
    ).toThrow();
  });

  it('rejects out-of-range trust_score on Trustpilot', () => {
    expect(() =>
      validatePlatformSpecific('trustpilot', { business_trust_score: 99 }),
    ).toThrow();
  });

  it('rejects invalid complaint_status enum on BBB', () => {
    expect(() =>
      validatePlatformSpecific('bbb', { complaint_status: 'imaginary' }),
    ).toThrow();
  });

  it('accepts a complete valid BBB payload', () => {
    const ok = {
      complaint_type: 'billing',
      complaint_status: 'resolved',
      case_id: 'BBB-20260515-3',
      resolution_summary: 'Refund issued.',
      filed_at: '2026-05-15T09:00:00.000Z',
    };
    expect(() => validatePlatformSpecific('bbb', ok)).not.toThrow();
  });
});

describe('generateReviewsForDay — external id stability', () => {
  it('external ids encode platform + day + index uniqueness within a day', () => {
    const out = generateReviewsForDay({
      orgId: ORG,
      accountId: ACCOUNT,
      day: '2026-05-15',
      platform: 'trustpilot',
    });
    const ids = new Set<string>();
    for (const r of out) {
      ids.add(r.externalId);
      expect(r.externalId.startsWith('trustpilot-')).toBe(true);
      expect(r.externalId.includes('2026-05-15')).toBe(true);
    }
    expect(ids.size).toBe(out.length);
  });
});

describe('MockReview rating contract', () => {
  it('non-BBB platforms always carry an integer rating 1..5', () => {
    const platforms = ['yelp', 'tripadvisor', 'trustpilot', 'avvo'] as const;
    for (const platform of platforms) {
      for (let i = 0; i < 8; i += 1) {
        const out: ReadonlyArray<MockReview> = generateReviewsForDay({
          orgId: ORG,
          accountId: `${ACCOUNT}-${platform}-${i}`,
          day: `2026-05-${String(i + 1).padStart(2, '0')}`,
          platform,
        });
        for (const r of out) {
          expect(r.rating).not.toBeNull();
          expect(Number.isInteger(r.rating)).toBe(true);
          expect(r.rating!).toBeGreaterThanOrEqual(1);
          expect(r.rating!).toBeLessThanOrEqual(5);
        }
      }
    }
  });
});
