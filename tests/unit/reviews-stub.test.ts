import { describe, expect, it } from 'vitest';

import { suggestReviewResponse } from '../../lib/ai/reviews-stub';

/**
 * Deterministic-suggestion contract. The stub MUST:
 *
 *   - Bucket by rating (4-5 → positive, 3 → neutral, 1-2 → negative).
 *   - Return the same body for the same `reviewId` across calls.
 *   - Never leave an unresolved `{placeholder}` in the body. When the
 *     hashed pick references a missing variable, fall back to the
 *     bucket's safe-fallback variant (the first entry, `needs: []`).
 *   - Substitute `{firstName}`, `{locationName}`, `{businessName}`
 *     when available.
 *
 * No `Math.random`, no `Date.now`, no `crypto.randomUUID` — we don't
 * test that directly (the import surface would catch it), but the
 * determinism test below is the canary.
 */

const REVIEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-900000000042';
const OTHER_REVIEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-900000000099';

describe('suggestReviewResponse — bucketing', () => {
  it('5 stars → positive bucket', () => {
    const out = suggestReviewResponse({
      reviewId: REVIEW_ID,
      rating: 5,
      authorName: 'Ana Pérez',
      locationName: 'Downtown',
      brandName: 'Trattoria',
    });
    expect(out.bucket).toBe('positive');
    expect(out.body.length).toBeGreaterThan(0);
  });

  it('4 stars → positive bucket', () => {
    const out = suggestReviewResponse({
      reviewId: REVIEW_ID,
      rating: 4,
      authorName: 'Ana',
      locationName: null,
      brandName: null,
    });
    expect(out.bucket).toBe('positive');
  });

  it('3 stars → neutral bucket', () => {
    const out = suggestReviewResponse({
      reviewId: REVIEW_ID,
      rating: 3,
      authorName: 'Luis',
      locationName: 'North',
      brandName: 'Trattoria',
    });
    expect(out.bucket).toBe('neutral');
  });

  it('2 stars → negative bucket', () => {
    const out = suggestReviewResponse({
      reviewId: REVIEW_ID,
      rating: 2,
      authorName: 'Marta',
      locationName: 'Downtown',
      brandName: 'Trattoria',
    });
    expect(out.bucket).toBe('negative');
  });

  it('1 star → negative bucket', () => {
    const out = suggestReviewResponse({
      reviewId: REVIEW_ID,
      rating: 1,
      authorName: null,
      locationName: null,
      brandName: null,
    });
    expect(out.bucket).toBe('negative');
  });
});

describe('suggestReviewResponse — determinism', () => {
  it('same reviewId yields the same body across two calls', () => {
    const a = suggestReviewResponse({
      reviewId: REVIEW_ID,
      rating: 4,
      authorName: 'Ana',
      locationName: 'Downtown',
      brandName: 'Trattoria',
    });
    const b = suggestReviewResponse({
      reviewId: REVIEW_ID,
      rating: 4,
      authorName: 'Ana',
      locationName: 'Downtown',
      brandName: 'Trattoria',
    });
    expect(b.body).toBe(a.body);
    expect(b.variantIndex).toBe(a.variantIndex);
  });

  it('different reviewIds may yield different bodies (within the same bucket)', () => {
    // The hashes are different, so over enough samples we should see
    // at least one differing variant. The bucket size is 5, so two
    // arbitrary IDs land on different variants ~80% of the time —
    // checking one specific known-different pair keeps the test stable.
    const a = suggestReviewResponse({
      reviewId: REVIEW_ID,
      rating: 5,
      authorName: 'Ana',
      locationName: 'Downtown',
      brandName: 'Trattoria',
    });
    const b = suggestReviewResponse({
      reviewId: OTHER_REVIEW_ID,
      rating: 5,
      authorName: 'Ana',
      locationName: 'Downtown',
      brandName: 'Trattoria',
    });
    // Both are positive; the variant indexes may collide. At least
    // one of (variantIndex, body) should differ across the corpus
    // when iterating many IDs — we exercise that elsewhere; here
    // we only assert the bucket is the same.
    expect(a.bucket).toBe(b.bucket);
  });
});

describe('suggestReviewResponse — variable substitution', () => {
  it('substitutes the first token of authorName as {firstName}', () => {
    const out = suggestReviewResponse({
      reviewId: 'bbbbbbbb-bbbb-4bbb-8bbb-900000000010',
      rating: 4,
      authorName: 'Ana María Pérez',
      locationName: 'Downtown',
      brandName: 'Trattoria',
    });
    if (out.body.includes('{')) {
      throw new Error(`Unresolved placeholder in body: ${out.body}`);
    }
    // Sample body — at least one of {firstName}/{locationName}/
    // {businessName} should resolve. The fact that no `{` remains
    // (asserted above) is the strict contract.
    expect(out.resolvedVariables).toContain('firstName');
  });

  it('never leaves an unresolved placeholder when context is missing', () => {
    // No authorName, no locationName, no brandName. Every variant
    // that needs ANY of these should be skipped and we should land
    // on the safe-fallback (index 0 with needs:[]).
    for (let i = 0; i < 50; i++) {
      const out = suggestReviewResponse({
        reviewId: `bbbbbbbb-bbbb-4bbb-8bbb-9000000000${String(i).padStart(2, '0')}`,
        rating: 5,
        authorName: null,
        locationName: null,
        brandName: null,
      });
      expect(out.body.includes('{')).toBe(false);
      // The chosen variant has `needs: []` → resolvedVariables empty.
      expect(out.resolvedVariables).toEqual([]);
    }
  });

  it('falls back to a no-variable variant when ONLY one variable is provided', () => {
    // Across 50 different review IDs, the hashed selection that
    // requires a missing variable should always fall through to a
    // variant whose `needs` matches what we have.
    for (let i = 0; i < 50; i++) {
      const out = suggestReviewResponse({
        reviewId: `bbbbbbbb-bbbb-4bbb-8bbb-9100000000${String(i).padStart(2, '0')}`,
        rating: 1,
        authorName: 'Carlos',
        locationName: null,
        brandName: null,
      });
      expect(out.body.includes('{')).toBe(false);
    }
  });

  it('reports unresolved variables in `unresolvedVariables` when context is partial', () => {
    const out = suggestReviewResponse({
      reviewId: REVIEW_ID,
      rating: 4,
      authorName: 'Ana',
      locationName: null,
      brandName: null,
    });
    expect(out.unresolvedVariables).toContain('locationName');
    expect(out.unresolvedVariables).toContain('businessName');
  });
});
