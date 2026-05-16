import { describe, expect, it } from 'vitest';

import {
  normalizeTone,
  suggestCaptionStub,
  type BrandTone,
  type CampaignGoal,
  type SuggestCaptionInput,
} from '../../lib/ai/caption-stub';

/**
 * Deterministic caption-stub coverage (Commit 19c.2). Same
 * `(postId, brandId, index)` → same output. Variants cycle
 * predictably as `index` advances. Variables that don't resolve
 * trigger the bucket's first variant (always `needs=[]`).
 */

const POST_A = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const POST_B = '11111111-1111-4111-8111-bbbbbbbbbbbb';
const BRAND_A = '22222222-2222-4222-8222-aaaaaaaaaaaa';

function input(overrides: Partial<SuggestCaptionInput> = {}): SuggestCaptionInput {
  return {
    postId: POST_A,
    brandId: BRAND_A,
    brandName: 'La Trattoria',
    locationName: 'Centro',
    productHint: 'Pizza margarita',
    goal: 'promotion',
    tone: 'friendly',
    index: 0,
    ...overrides,
  };
}

describe('suggestCaptionStub — determinism', () => {
  it('same input twice → same output', () => {
    const a = suggestCaptionStub(input());
    const b = suggestCaptionStub(input());
    expect(a.body).toBe(b.body);
    expect(a.variantIndex).toBe(b.variantIndex);
    expect(a.bucket).toBe(b.bucket);
  });

  it('different postId → potentially different variant (but still deterministic)', () => {
    const a = suggestCaptionStub(input({ postId: POST_A }));
    const b = suggestCaptionStub(input({ postId: POST_B }));
    expect(suggestCaptionStub(input({ postId: POST_A })).body).toBe(a.body);
    expect(suggestCaptionStub(input({ postId: POST_B })).body).toBe(b.body);
  });
});

describe('suggestCaptionStub — index cycle (regenerate)', () => {
  it('successive index values cover distinct variants', () => {
    const bodies = new Set<string>();
    for (let i = 0; i < 5; i++) {
      bodies.add(suggestCaptionStub(input({ index: i })).body);
    }
    // Expect at least 3 distinct bodies across 5 indices — buckets
    // have 5-7 variants, with a fallback to variant[0] when needs
    // are unmet. Repeat hits are OK; what we don't want is "every
    // index returns the same body".
    expect(bodies.size).toBeGreaterThanOrEqual(3);
  });
});

describe('suggestCaptionStub — variables resolve / fallback', () => {
  it('resolves {brandName} when provided', () => {
    // Force the brand-name variant by picking promotion_friendly + low-index
    // combination. We test the substitution mechanically: the returned
    // body must not contain the literal "{brandName}".
    const result = suggestCaptionStub(input());
    expect(result.body).not.toContain('{brandName}');
    expect(result.body).not.toContain('{locationName}');
    expect(result.body).not.toContain('{productHint}');
  });

  it('falls back to the safe variant when brandName is missing', () => {
    const result = suggestCaptionStub(
      input({
        brandName: null,
        locationName: null,
        productHint: null,
      }),
    );
    expect(result.body).not.toContain('{');
    expect(result.unresolvedVariables.length).toBe(0);
    expect(result.resolvedVariables.length).toBe(0);
  });
});

describe('suggestCaptionStub — bucket fallback', () => {
  it('uses requested bucket when populated', () => {
    const result = suggestCaptionStub(input({ goal: 'promotion', tone: 'friendly' }));
    expect(result.bucket).toBe('promotion_friendly');
    expect(result.fellBackToDefault).toBe(false);
  });

  it('falls back to evergreen_friendly for unpopulated combinations', () => {
    const result = suggestCaptionStub(input({ goal: 'crisis', tone: 'playful' }));
    expect(result.bucket).toBe('evergreen_friendly');
    expect(result.fellBackToDefault).toBe(true);
  });

  it('never returns an unresolved {placeholder}', () => {
    // Sweep all (goal × tone) pairs. The function MUST always
    // return a body without literal templating syntax.
    const goals: ReadonlyArray<CampaignGoal> = [
      'awareness',
      'engagement',
      'leads',
      'reviews',
      'reputation',
      'event',
      'launch',
      'promotion',
      'education',
      'crisis',
      'seasonal',
      'evergreen',
    ];
    const tones: ReadonlyArray<BrandTone> = [
      'formal',
      'friendly',
      'professional',
      'playful',
      'premium',
      'warm',
      'institutional',
      'concise',
    ];
    for (const goal of goals) {
      for (const tone of tones) {
        for (let idx = 0; idx < 3; idx++) {
          const result = suggestCaptionStub(input({ goal, tone, index: idx }));
          expect(result.body).not.toContain('{brandName}');
          expect(result.body).not.toContain('{locationName}');
          expect(result.body).not.toContain('{productHint}');
        }
      }
    }
  });
});

describe('normalizeTone', () => {
  it('passes through known tones', () => {
    expect(normalizeTone('friendly')).toBe('friendly');
    expect(normalizeTone('FORMAL')).toBe('formal');
    expect(normalizeTone(' Professional ')).toBe('professional');
  });
  it('falls back to friendly for unknown / empty', () => {
    expect(normalizeTone(null)).toBe('friendly');
    expect(normalizeTone('')).toBe('friendly');
    expect(normalizeTone('rude')).toBe('friendly');
  });
});
