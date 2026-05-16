import { describe, expect, it } from 'vitest';

import { complianceCheck } from '../../lib/ai/compliance-stub';

/**
 * Review-specific compliance signals (Commit 14, Ajuste 2). These SUM to
 * the base keyword rules — a response can trigger both the base
 * `refund_promise` flag AND the new `low_rating_monetary_offer` flag.
 */

const CTX = {
  entityType: 'review' as const,
  brandName: 'Trattoria',
  locationName: 'Downtown',
};

describe('complianceCheck — review context: low-rating monetary offer', () => {
  it('flags low_rating_monetary_offer on 1★ + "refund"', () => {
    const r = complianceCheck('Te enviaremos un refund inmediato.', {
      ...CTX,
      rating: 1,
    });
    expect(r.flags).toContain('low_rating_monetary_offer');
    expect(r.flags).toContain('refund_promise'); // base flag still fires
    expect(r.requiresApproval).toBe(true);
    expect(r.riskLevel).toBe('high');
  });

  it('flags low_rating_monetary_offer on 2★ + "descuento"', () => {
    const r = complianceCheck(
      'Te ofrecemos un descuento de 30% en tu próxima visita.',
      { ...CTX, rating: 2 },
    );
    expect(r.flags).toContain('low_rating_monetary_offer');
    expect(r.riskLevel).toBe('high');
  });

  it('flags low_rating_monetary_offer on 2★ + "compensation"', () => {
    const r = complianceCheck(
      'We will issue compensation for the inconvenience.',
      { ...CTX, rating: 2 },
    );
    expect(r.flags).toContain('low_rating_monetary_offer');
  });

  it('does NOT flag low_rating_monetary_offer on 4★ + "refund"', () => {
    // High-rating refund mention still triggers the base
    // `refund_promise` flag, but NOT the low-rating-specific one.
    const r = complianceCheck('Para tu refund, pasa por la sucursal.', {
      ...CTX,
      rating: 4,
    });
    expect(r.flags).not.toContain('low_rating_monetary_offer');
    expect(r.flags).toContain('refund_promise');
  });

  it('does NOT flag low_rating_monetary_offer when rating is missing', () => {
    const r = complianceCheck('Te ofrecemos un refund inmediato.', CTX);
    expect(r.flags).not.toContain('low_rating_monetary_offer');
    expect(r.flags).toContain('refund_promise');
  });
});

describe('complianceCheck — review context: named person outside allowlist', () => {
  it('flags named_person_outside_allowlist when a capitalized name leaks', () => {
    const r = complianceCheck(
      'Lo sentimos. María revisará tu caso personalmente.',
      { ...CTX, rating: 5 },
    );
    expect(r.flags).toContain('named_person_outside_allowlist');
    expect(r.riskLevel).toBe('medium');
  });

  it('does NOT flag the brand or location name', () => {
    // "Trattoria" + "Downtown" are in the allowlist — and they're
    // sentence-internal so the start-of-sentence rule doesn't kick in.
    const r = complianceCheck(
      'En la Trattoria Downtown trabajamos para mejorar.',
      { ...CTX, rating: 5 },
    );
    expect(r.flags).not.toContain('named_person_outside_allowlist');
  });

  it('does NOT flag a sentence-leading greeting like "Hola" or "Gracias"', () => {
    const r = complianceCheck('Hola. Gracias por tu reseña.', {
      ...CTX,
      rating: 5,
    });
    expect(r.flags).not.toContain('named_person_outside_allowlist');
  });
});

describe('complianceCheck — review context: long response', () => {
  it('flags long_response above 800 chars', () => {
    const body = 'a'.repeat(900);
    const r = complianceCheck(body, { ...CTX, rating: 5 });
    expect(r.flags).toContain('long_response');
    expect(r.requiresApproval).toBe(true);
    // long_response alone → risk stays low (a long but otherwise
    // clean response still gets a human review, but isn't high-risk).
    expect(r.riskLevel).toBe('low');
  });

  it('does NOT flag long_response at 799 chars', () => {
    const body = 'a'.repeat(799);
    const r = complianceCheck(body, { ...CTX, rating: 5 });
    expect(r.flags).not.toContain('long_response');
  });
});

describe('complianceCheck — review context: signals SUM to base flags', () => {
  it('combines low_rating_monetary_offer + long_response without losing base flags', () => {
    const longBody =
      'Te ofrecemos un refund completo y queremos resolver esto. ' +
      'a'.repeat(820);
    const r = complianceCheck(longBody, { ...CTX, rating: 1 });
    expect(r.flags).toContain('low_rating_monetary_offer');
    expect(r.flags).toContain('refund_promise');
    expect(r.flags).toContain('long_response');
    expect(r.requiresApproval).toBe(true);
    // low_rating_monetary_offer dominates the risk → high.
    expect(r.riskLevel).toBe('high');
  });

  it('inbox callers (no entityType=review) do NOT get the review-specific flags', () => {
    // Same body that flagged above, called without review context.
    const r = complianceCheck('Te ofrecemos un refund inmediato.');
    expect(r.flags).not.toContain('low_rating_monetary_offer');
    expect(r.flags).not.toContain('named_person_outside_allowlist');
    expect(r.flags).not.toContain('long_response');
    expect(r.flags).toContain('refund_promise'); // base list still applies
  });
});

describe('complianceCheck — determinism still holds with review context', () => {
  it('same input + context → same output', () => {
    const a = complianceCheck('Te ofrecemos un descuento.', {
      ...CTX,
      rating: 1,
    });
    const b = complianceCheck('Te ofrecemos un descuento.', {
      ...CTX,
      rating: 1,
    });
    expect(a).toEqual(b);
  });
});
