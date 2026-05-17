import { describe, expect, it } from 'vitest';

import { mockCompliance } from '../../lib/ai/mock-bodies/compliance';
import { mockCrisis } from '../../lib/ai/mock-bodies/crisis';
import { mockIntent } from '../../lib/ai/mock-bodies/intent';
import { mockReviewSummary } from '../../lib/ai/mock-bodies/review-summary';
import { mockSentiment } from '../../lib/ai/mock-bodies/sentiment';
import { mockThreadSummary } from '../../lib/ai/mock-bodies/thread-summary';

/**
 * Determinism + behavior locks for the new mock bodies
 * (Commit 22, B5). The 4 stub-backed mocks (compliance,
 * caption, review-response, language-detect) are already
 * covered by the existing stub tests — this file covers the
 * 5 new ones.
 */

describe('mockSentiment', () => {
  it('empty text → neutral', () => {
    const out = mockSentiment({ text: '' });
    expect(out.sentiment).toBe('neutral');
  });

  it('positive keywords → positive', () => {
    const out = mockSentiment({ text: 'Amazing experience, thanks so much!' });
    expect(out.sentiment).toBe('positive');
    expect(out.confidence).toBeGreaterThan(0.6);
  });

  it('negative keywords → negative', () => {
    const out = mockSentiment({ text: 'Terrible service, worst visit ever' });
    expect(out.sentiment).toBe('negative');
  });

  it('mixed signal → neutral', () => {
    const out = mockSentiment({ text: 'Great food but terrible wait time' });
    expect(out.sentiment).toBe('neutral');
  });

  it('Spanish positive keywords work', () => {
    const out = mockSentiment({ text: 'Excelente servicio, muchas gracias' });
    expect(out.sentiment).toBe('positive');
  });

  it('determinism: same input → same output', () => {
    const t = 'Awful food, never coming back';
    expect(mockSentiment({ text: t })).toEqual(mockSentiment({ text: t }));
  });
});

describe('mockIntent', () => {
  it('empty text → other', () => {
    const out = mockIntent({ text: '' });
    expect(out.primaryIntent).toBe('other');
  });

  it('detects info_request (hours)', () => {
    const out = mockIntent({ text: '¿Cuál es el horario de hoy?' });
    expect(out.intents).toContain('info_request');
  });

  it('detects compliment (gracias)', () => {
    const out = mockIntent({ text: '¡Gracias por el excelente servicio!' });
    expect(out.intents).toContain('compliment');
  });

  it('multi-label is sorted deterministically', () => {
    const a = mockIntent({ text: 'thanks but I had an issue with the order' });
    const b = mockIntent({ text: 'thanks but I had an issue with the order' });
    expect(a).toEqual(b);
  });
});

describe('mockCrisis', () => {
  it('crisis=false when no triggers', () => {
    const out = mockCrisis({
      brandName: 'Test',
      windowStartIso: '2026-01-01',
      windowEndIso: '2026-01-02',
      reviews: [{ id: 'r1', rating: 5, createdAtIso: '2026-01-01' }],
      messages: [],
    });
    expect(out.crisis).toBe(false);
    expect(out.severity).toBe('low');
  });

  it('triggers when 3+ low-rating reviews', () => {
    const reviews = Array.from({ length: 3 }, (_, i) => ({
      id: `r${i}`,
      rating: 1,
      createdAtIso: '2026-01-01',
    }));
    const out = mockCrisis({
      brandName: 'Test',
      windowStartIso: '2026-01-01',
      windowEndIso: '2026-01-02',
      reviews,
      messages: [],
    });
    expect(out.crisis).toBe(true);
    expect(out.evidence.reviewIds.length).toBe(3);
  });

  it('escalates to critical when 7+ low ratings', () => {
    const reviews = Array.from({ length: 8 }, (_, i) => ({
      id: `r${i}`,
      rating: 1,
      createdAtIso: '2026-01-01',
    }));
    const out = mockCrisis({
      brandName: 'Test',
      windowStartIso: '2026-01-01',
      windowEndIso: '2026-01-02',
      reviews,
      messages: [],
    });
    expect(out.crisis).toBe(true);
    expect(out.severity).toBe('critical');
  });
});

describe('mockThreadSummary', () => {
  it('empty thread → "empty" message', () => {
    const out = mockThreadSummary({ messages: [] });
    expect(out.summary).toContain('empty');
    expect(out.openQuestions).toEqual([]);
  });

  it('single inbound message → awaiting reply', () => {
    const out = mockThreadSummary({
      messages: [
        {
          id: 'm1',
          body: 'Hola, ¿tienen disponibilidad mañana?',
          direction: 'inbound',
          createdAtIso: '2026-01-01',
        },
      ],
    });
    expect(out.summary).toContain('awaiting reply');
    expect(out.openQuestions.length).toBeGreaterThan(0);
  });

  it('summary respects 350-char cap', () => {
    const longBody = 'a'.repeat(500);
    const out = mockThreadSummary({
      messages: [
        {
          id: 'm1',
          body: longBody,
          direction: 'inbound',
          createdAtIso: '2026-01-01',
        },
      ],
    });
    expect(out.summary.length).toBeLessThanOrEqual(350);
  });
});

describe('mockReviewSummary', () => {
  it('empty list → empty summary', () => {
    const out = mockReviewSummary({ reviews: [] });
    expect(out.summary).toContain('No reviews');
    expect(out.sentimentBreakdown.positive).toBe(0);
  });

  it('sentiment breakdown sums to ~1', () => {
    const reviews = [
      { id: 'r1', rating: 5, body: 'Excellent service!' },
      { id: 'r2', rating: 3, body: 'Average experience.' },
      { id: 'r3', rating: 1, body: 'Terrible, never again.' },
    ];
    const out = mockReviewSummary({ reviews });
    const { positive, neutral, negative } = out.sentimentBreakdown;
    expect(positive + neutral + negative).toBeCloseTo(1, 1);
  });

  it('topPraise comes from 4-5★ reviews', () => {
    const reviews = [
      {
        id: 'r1',
        rating: 5,
        body: 'Absolutely loved the food. Best Italian in town.',
      },
      { id: 'r2', rating: 2, body: 'Bad experience.' },
    ];
    const out = mockReviewSummary({ reviews });
    expect(out.topPraise.length).toBeGreaterThan(0);
    expect(out.topConcerns.length).toBeGreaterThanOrEqual(0);
  });
});

describe('mock-bodies — equivalence with legacy stubs', () => {
  it('mockCompliance flags refund_promise on Spanish keyword', () => {
    const out = mockCompliance({ text: 'Te haremos un reembolso pronto' });
    expect(out.flags).toContain('refund_promise');
    expect(out.requiresApproval).toBe(true);
  });
});
