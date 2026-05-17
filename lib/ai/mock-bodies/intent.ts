/**
 * Mock body for the `intent` skill (Commit 22). Deterministic
 * multi-label keyword classifier. Phase 11 swaps with Haiku.
 *
 * Output `intents` is a sorted unique subset of the label enum;
 * `primaryIntent` is the highest-scoring label, with `'other'` as
 * the always-present fallback when no signal matches.
 */

export type IntentLabel =
  | 'support_request'
  | 'complaint'
  | 'compliment'
  | 'info_request'
  | 'sales_inquiry'
  | 'spam'
  | 'other';

export interface IntentMockInput {
  readonly text: string;
}

export interface IntentMockOutput {
  readonly intents: ReadonlyArray<IntentLabel>;
  readonly primaryIntent: IntentLabel;
}

const SIGNALS: ReadonlyArray<{ label: IntentLabel; keywords: ReadonlyArray<string> }> = [
  {
    label: 'support_request',
    keywords: [
      // EN
      'help', 'support', 'issue', 'problem', 'broken', "doesn't work", 'not working',
      // ES
      'ayuda', 'soporte', 'problema', 'no funciona', 'falla', 'roto', 'rota',
    ],
  },
  {
    label: 'complaint',
    keywords: [
      // EN
      'complain', 'complaint', 'terrible', 'awful', 'worst', 'rude', 'disappointed',
      // ES
      'queja', 'reclamo', 'terrible', 'pésimo', 'grosero', 'decepcionado',
    ],
  },
  {
    label: 'compliment',
    keywords: [
      // EN
      'great', 'amazing', 'love', 'excellent', 'thanks', 'thank you',
      // ES
      'excelente', 'increíble', 'gracias', 'genial', 'amamos', 'encanta',
    ],
  },
  {
    label: 'info_request',
    keywords: [
      // EN
      'hours', 'open', 'closed', 'where', 'address', 'price', 'cost', 'menu',
      'when', 'do you',
      // ES
      'horario', 'horarios', 'abren', 'cierran', 'dónde', 'dirección',
      'precio', 'costo', 'cuesta', 'menú', 'cuándo', 'tienen',
    ],
  },
  {
    label: 'sales_inquiry',
    keywords: [
      // EN
      'buy', 'purchase', 'book', 'reserve', 'reservation', 'order', 'interested in',
      // ES
      'comprar', 'reservar', 'reserva', 'pedido', 'ordenar', 'interesado',
      'interesada',
    ],
  },
  {
    label: 'spam',
    keywords: [
      // Patterns common in unsolicited DM blasts.
      'crypto', 'investment', 'follow back', 'check my profile', 'click link',
      'sígueme', 'inversión', 'criptomoneda', 'haz clic',
    ],
  },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasKeyword(haystack: string, kw: string): boolean {
  const re = new RegExp(`(?<![\\p{L}])${escapeRegex(kw)}(?![\\p{L}])`, 'iu');
  return re.test(haystack);
}

export function mockIntent(input: IntentMockInput): IntentMockOutput {
  const text = (input.text ?? '').trim();
  if (text.length === 0) {
    return { intents: ['other'], primaryIntent: 'other' };
  }

  const scores = new Map<IntentLabel, number>();
  for (const { label, keywords } of SIGNALS) {
    let n = 0;
    for (const kw of keywords) if (hasKeyword(text, kw)) n++;
    if (n > 0) scores.set(label, n);
  }

  if (scores.size === 0) {
    return { intents: ['other'], primaryIntent: 'other' };
  }

  // Sort labels by descending score, then alphabetical for stable
  // output order. Determinism matters for the audit row.
  const ranked = [...scores.entries()].sort(([la, na], [lb, nb]) => {
    if (na !== nb) return nb - na;
    return la.localeCompare(lb);
  });
  const intents = ranked.map(([label]) => label);
  return { intents, primaryIntent: intents[0]! };
}
