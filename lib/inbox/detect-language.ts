/**
 * Stopword-based language detection for the inbox composer.
 *
 * NOT AI — this is a static rules module. We tokenise the last
 * inbound message (first 500 chars), count how many whitelisted
 * stopwords appear per language, and return whichever language wins.
 * Ties or counts below the confidence threshold return `'unknown'`,
 * so the composer can show "Idioma no detectado" without forcing a
 * potentially-wrong default.
 *
 * In Phase 7 the body of `detectLanguage()` is replaced with a Claude
 * Haiku call (cached system prompt + structured output). The signature
 * and the four-language whitelist stay the same — callers are
 * insulated from the swap.
 */

export const SUPPORTED_LANGUAGES = ['es', 'en', 'pt', 'fr'] as const;
export type DetectedLanguage = (typeof SUPPORTED_LANGUAGES)[number] | 'unknown';

const SAMPLE_WINDOW = 500;
const MIN_MATCHES = 3;

/**
 * Small, hand-picked stopword sets. We avoid words that overlap
 * heavily across the four languages (e.g. "no" in es/en/pt/fr) so a
 * sentence with a few function words gets a clear winner. Adding
 * stopwords here is fine; just check the overlap mentally first.
 */
const STOPWORDS: Record<Exclude<DetectedLanguage, 'unknown'>, ReadonlyArray<string>> = {
  es: [
    'el', 'la', 'los', 'las', 'que', 'de', 'en', 'un', 'una', 'por',
    'para', 'con', 'pero', 'como', 'esto', 'esta', 'cuando', 'tiene',
    'gracias', 'hola', 'cómo', 'aquí', 'dónde', 'también', 'porque',
    'según', 'están', 'soy', 'soy',
  ],
  en: [
    'the', 'and', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on',
    'with', 'for', 'this', 'that', 'have', 'has', 'thanks', 'hello',
    'please', 'about', 'where', 'when', 'because', 'would', 'should',
  ],
  pt: [
    'o', 'os', 'as', 'que', 'de', 'em', 'um', 'uma', 'por', 'para',
    'com', 'mas', 'como', 'isto', 'esta', 'quando', 'tem', 'obrigado',
    'olá', 'porque', 'também', 'aqui', 'onde', 'estão',
  ],
  fr: [
    'le', 'la', 'les', 'que', 'de', 'en', 'un', 'une', 'pour', 'avec',
    'mais', 'comme', 'ceci', 'quand', 'merci', 'bonjour', 'parce',
    'aussi', 'ici', 'où', 'sont', 'voilà', "c'est",
  ],
};

const TOKEN_RE = /[\p{L}'’]+/gu;

function tokenize(input: string): string[] {
  const window = input.slice(0, SAMPLE_WINDOW).toLowerCase();
  return Array.from(window.matchAll(TOKEN_RE), (m) => m[0]);
}

/**
 * Best-guess language for `text`. Returns `'unknown'` when:
 *
 *   - no whitelisted stopword appears at all,
 *   - the top language has fewer than `MIN_MATCHES` hits, or
 *   - the top two languages tie.
 *
 * `'unknown'` is the right answer for very short messages — the UI
 * treats it as "leave the language pill empty" rather than guessing.
 */
export function detectLanguage(text: string | null | undefined): DetectedLanguage {
  if (!text || text.trim().length === 0) return 'unknown';

  const tokens = new Set(tokenize(text));
  let bestLang: Exclude<DetectedLanguage, 'unknown'> | null = null;
  let bestCount = 0;
  let runnerUpCount = 0;

  for (const lang of SUPPORTED_LANGUAGES) {
    let count = 0;
    for (const stopword of STOPWORDS[lang]) {
      if (tokens.has(stopword)) count++;
    }
    if (count > bestCount) {
      runnerUpCount = bestCount;
      bestCount = count;
      bestLang = lang;
    } else if (count > runnerUpCount) {
      runnerUpCount = count;
    }
  }

  if (!bestLang || bestCount < MIN_MATCHES) return 'unknown';
  // Tie-break: a tie means we don't know.
  if (bestCount === runnerUpCount) return 'unknown';
  return bestLang;
}
