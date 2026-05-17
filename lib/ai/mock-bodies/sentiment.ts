/**
 * Mock body for the `sentiment` skill (Commit 22). Deterministic
 * keyword heuristic — Phase 11 swaps with the Haiku classifier
 * from `prompts.SENTIMENT_SYSTEM_PROMPT_V1`.
 *
 * Rules:
 *   - Empty / null → neutral, confidence 0.5.
 *   - >= 1 NEGATIVE_KEYWORDS match and 0 positive → negative.
 *   - >= 1 POSITIVE_KEYWORDS match and 0 negative → positive.
 *   - Mixed signal OR neither → neutral.
 *   - Confidence: 0.85 when single-class signal is unambiguous;
 *     0.55 when low-signal; 0.5 for neutral default.
 *
 * Bilingual ES/EN coverage — matches the kinds of language
 * customers actually use in reviews / inbox messages.
 */

export interface SentimentMockInput {
  readonly text: string;
}

export interface SentimentMockOutput {
  readonly sentiment: 'positive' | 'neutral' | 'negative';
  readonly confidence: number;
}

const POSITIVE_KEYWORDS: ReadonlyArray<string> = [
  // EN
  'great', 'amazing', 'excellent', 'love', 'loved', 'fantastic', 'wonderful',
  'thanks', 'thank you', 'awesome', 'best', 'recommend', 'perfect',
  'happy', 'delicious', 'beautiful',
  // ES
  'excelente', 'increíble', 'genial', 'fantástico', 'gracias', 'recomiendo',
  'recomendado', 'amor', 'amamos', 'feliz', 'felices', 'maravilloso',
  'delicioso', 'hermoso', 'perfecto', 'encanta', 'encantó',
];

const NEGATIVE_KEYWORDS: ReadonlyArray<string> = [
  // EN
  'terrible', 'awful', 'horrible', 'worst', 'bad', 'disappointed',
  'disappointing', 'angry', 'upset', 'complaint', 'refund', 'rude',
  'never', 'avoid', 'waste',
  // ES
  'terrible', 'horrible', 'pésimo', 'malo', 'mala', 'decepcionado',
  'decepcionada', 'molesto', 'queja', 'reembolso', 'grosero', 'grosera',
  'nunca', 'evitar', 'desperdicio',
];

const NEGATION_PREFIXES: ReadonlyArray<string> = ['no ', 'not ', 'never '];

function matchCount(haystack: string, keywords: ReadonlyArray<string>): number {
  let count = 0;
  for (const kw of keywords) {
    const re = new RegExp(`(?<![\\p{L}])${escapeRegex(kw)}(?![\\p{L}])`, 'iu');
    if (re.test(haystack)) {
      // Crude negation: skip if the keyword has a negation prefix
      // within 6 chars before it. Cheap; the real classifier
      // handles this far better.
      const idx = haystack.toLowerCase().indexOf(kw.toLowerCase());
      const prefix = haystack.slice(Math.max(0, idx - 6), idx).toLowerCase();
      if (NEGATION_PREFIXES.some((np) => prefix.endsWith(np))) continue;
      count++;
    }
  }
  return count;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mockSentiment(input: SentimentMockInput): SentimentMockOutput {
  const text = (input.text ?? '').trim();
  if (text.length === 0) return { sentiment: 'neutral', confidence: 0.5 };

  const pos = matchCount(text, POSITIVE_KEYWORDS);
  const neg = matchCount(text, NEGATIVE_KEYWORDS);

  if (pos > 0 && neg === 0) {
    return { sentiment: 'positive', confidence: pos >= 2 ? 0.85 : 0.7 };
  }
  if (neg > 0 && pos === 0) {
    return { sentiment: 'negative', confidence: neg >= 2 ? 0.85 : 0.7 };
  }
  // Mixed / no signal.
  return { sentiment: 'neutral', confidence: 0.55 };
}
