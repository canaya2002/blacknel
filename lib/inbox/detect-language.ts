/**
 * Stopword-based language detection for the inbox composer.
 *
 * ════════════════════════════════════════════════════════════════
 *  REGLA BLACKNEL — AI-FEEDBACK PATTERN (dual API, formalized in Commit 24)
 * ════════════════════════════════════════════════════════════════
 *
 * This module exposes TWO entry points with the same goal but
 * different latency / precision tradeoffs:
 *
 *   - **`detectLanguage` (sync)** — stopword heuristic. For render
 *     hot paths where latency wins over marginal precision. Used
 *     in `components/inbox/composer.tsx` to drive the language
 *     pill while the user types.
 *
 *   - **`detectLanguageAi` (async, in `lib/ai/skills/language-detect.ts`)**
 *     — Haiku call via `aiClient`. For authoritative gates where
 *     precision wins over latency. Used in
 *     `lib/inbox/send-reply.ts` at submit time, anchored to the
 *     last-inbound `inbox_messages.id` (Commit 24 / Ajuste 2).
 *
 * **General principle.** When a skill has both a typing-time use
 * and a submission-time use, the pattern is: sync heuristic for
 * render, async AI for the gate. Precedent:
 * `complianceHint` (sync) + `checkCompliance` (async) — Commit 22.
 *
 * **Phase 11 cutover.** The async version becomes a real Anthropic
 * Haiku call (prompt-cached system prompt). The sync version
 * stays as the deterministic fallback for degraded paths
 * (rate_limit, timeout, schema_violation surfaced by `withFallback`).
 *
 * ════════════════════════════════════════════════════════════════
 *
 * Implementation notes for the sync path:
 *   - Tokenises the input (first 500 chars), counts whitelisted
 *     stopwords per language, returns the winner.
 *   - Ties or counts below `MIN_MATCHES` return `'unknown'` so
 *     the composer can show "Idioma no detectado" without
 *     forcing a potentially-wrong default.
 *   - The four-language whitelist (es / en / pt / fr) is the
 *     same set the async path supports.
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
