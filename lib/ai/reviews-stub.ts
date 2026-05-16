/**
 * Phase-5 review-response suggestion stub.
 *
 * Deterministic — same `reviewId` always returns the same suggestion
 * so tests, demos and the audit log all agree. Phase 7 swaps this for
 * a `claude-haiku-4-5` call through `lib/ai/client.ts` with prompt
 * caching enabled; the public API of `suggestReviewResponse` stays the
 * same so callers don't need to change.
 *
 * # Algorithm
 *
 *   1. Bucket by `rating`:
 *        - 5 or 4   → "positive"
 *        - 3        → "neutral"
 *        - 1 or 2   → "negative"
 *   2. From the bucket's variants, pick one by `hashCode(reviewId) %
 *      variants.length`. The hash is a tiny FNV-1a — pure ASCII math,
 *      no `crypto`, no `Math.random`, no `Date.now`.
 *   3. Substitute `{firstName}`, `{locationName}`, `{businessName}`
 *      from the input. If the chosen variant references a variable
 *      we cannot resolve, the function falls back to the first
 *      variant in the same bucket that doesn't need the missing
 *      variable. This guarantees the returned string NEVER contains
 *      an unresolved `{placeholder}`.
 *
 * # Why this shape
 *
 *   - **Determinism for tests.** Vitest snapshots stay stable; the
 *     same review always demos the same reply.
 *   - **Variety per org.** Different `reviewId`s land on different
 *     variants, so the demo inbox doesn't read like a robot copy-pasting
 *     the same line into every reply.
 *   - **No real-time dependency.** `Math.random`, `Date.now`, and
 *     `crypto.randomUUID` would all break determinism. We use none.
 */

export interface SuggestReviewResponseInput {
  reviewId: string;
  rating: number;
  authorName: string | null;
  locationName: string | null;
  brandName: string | null;
}

export interface SuggestReviewResponseOutput {
  body: string;
  /** Which variant index was chosen — useful for audits / logs. */
  variantIndex: number;
  bucket: 'positive' | 'neutral' | 'negative';
  /** Variables that resolved cleanly. Recorded for audit. */
  resolvedVariables: ReadonlyArray<'firstName' | 'locationName' | 'businessName'>;
  /** Variables that did not resolve. The chosen body never references these. */
  unresolvedVariables: ReadonlyArray<'firstName' | 'locationName' | 'businessName'>;
}

type VariableKey = 'firstName' | 'locationName' | 'businessName';

interface Variant {
  text: string;
  /** Which variables the template needs. Empty = safe-fallback variant. */
  needs: ReadonlyArray<VariableKey>;
}

// ---------------------------------------------------------------------------
// Variants per bucket. The first entry of every bucket has `needs: []` so
// it ALWAYS resolves — that's the fallback target when the hashed variant
// references a missing variable.
// ---------------------------------------------------------------------------

const POSITIVE_VARIANTS: ReadonlyArray<Variant> = [
  {
    text: '¡Gracias por tu reseña! Nos alegra mucho que la experiencia haya sido positiva.',
    needs: [],
  },
  {
    text: '¡Gracias, {firstName}! Nos hace muy felices saber que disfrutaste tu visita.',
    needs: ['firstName'],
  },
  {
    text: 'Mil gracias, {firstName}, por tomarte el tiempo de compartir esto. Te esperamos pronto en {locationName}.',
    needs: ['firstName', 'locationName'],
  },
  {
    text: 'Qué bueno leerte. En {businessName} trabajamos cada día para que la experiencia sea así. ¡Gracias!',
    needs: ['businessName'],
  },
  {
    text: 'Gracias por la recomendación, {firstName}. Compartiremos tu mensaje con todo el equipo de {locationName}.',
    needs: ['firstName', 'locationName'],
  },
];

const NEUTRAL_VARIANTS: ReadonlyArray<Variant> = [
  {
    text: 'Gracias por tu retroalimentación. La tomamos muy en cuenta para mejorar.',
    needs: [],
  },
  {
    text: 'Gracias, {firstName}. Tu comentario nos ayuda a identificar dónde podemos hacerlo mejor.',
    needs: ['firstName'],
  },
  {
    text: 'Agradecemos tu visita y tu opinión. En {locationName} seguimos trabajando para que la próxima sea aún mejor.',
    needs: ['locationName'],
  },
  {
    text: 'Gracias por compartir tu experiencia con {businessName}. Si quieres contarnos más detalles, escríbenos por mensaje directo.',
    needs: ['businessName'],
  },
];

const NEGATIVE_VARIANTS: ReadonlyArray<Variant> = [
  {
    text: 'Lamentamos mucho lo ocurrido. Nos gustaría revisar el caso a fondo — por favor envíanos un mensaje directo para resolverlo.',
    needs: [],
  },
  {
    text: 'Lamentamos lo sucedido, {firstName}. Un manager se pondrá en contacto contigo para entender el caso y darle seguimiento.',
    needs: ['firstName'],
  },
  {
    text: 'Sentimos mucho leer esto. En {locationName} no era la experiencia que queríamos darte; nos gustaría hablar contigo para resolverlo.',
    needs: ['locationName'],
  },
  {
    text: 'Gracias por avisarnos, {firstName}. En {businessName} tomamos muy en serio comentarios como el tuyo; por favor envíanos un mensaje directo y damos seguimiento de inmediato.',
    needs: ['firstName', 'businessName'],
  },
  {
    text: 'Lamentamos profundamente la situación. {firstName}, queremos escuchar los detalles directamente; ¿podrías contactarnos por mensaje privado?',
    needs: ['firstName'],
  },
];

const BUCKETS = {
  positive: POSITIVE_VARIANTS,
  neutral: NEUTRAL_VARIANTS,
  negative: NEGATIVE_VARIANTS,
} as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function suggestReviewResponse(
  input: SuggestReviewResponseInput,
): SuggestReviewResponseOutput {
  const bucket = bucketFor(input.rating);
  const variants = BUCKETS[bucket];
  const resolved = resolveVariables(input);

  // Hashed selection.
  const idx = fnv1aHash(input.reviewId) % variants.length;
  const initial = variants[idx]!;

  // Fall back to the first variant whose `needs` are all resolved.
  // The first variant in each bucket has `needs: []` so this loop
  // always terminates with a valid pick.
  let chosen = initial;
  let chosenIdx = idx;
  if (!variantResolves(initial, resolved)) {
    for (let i = 0; i < variants.length; i++) {
      const probe = variants[i]!;
      if (variantResolves(probe, resolved)) {
        chosen = probe;
        chosenIdx = i;
        break;
      }
    }
  }

  const body = substitute(chosen.text, resolved);
  const resolvedKeys = Object.entries(resolved)
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([k]) => k as VariableKey);
  const allKeys: VariableKey[] = ['firstName', 'locationName', 'businessName'];
  const unresolvedKeys = allKeys.filter((k) => !resolvedKeys.includes(k));

  return {
    body,
    variantIndex: chosenIdx,
    bucket,
    resolvedVariables: resolvedKeys,
    unresolvedVariables: unresolvedKeys,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bucketFor(rating: number): 'positive' | 'neutral' | 'negative' {
  if (rating >= 4) return 'positive';
  if (rating === 3) return 'neutral';
  return 'negative';
}

interface Resolved {
  firstName?: string;
  locationName?: string;
  businessName?: string;
}

function resolveVariables(input: SuggestReviewResponseInput): Resolved {
  const out: Resolved = {};
  if (input.authorName) {
    const first = input.authorName.trim().split(/\s+/u)[0];
    if (first && first.length > 0) {
      // Cap defensively — a 200-char "name" pasted into the seed
      // shouldn't blow the response length out.
      out.firstName = first.slice(0, 40);
    }
  }
  if (input.locationName && input.locationName.trim().length > 0) {
    out.locationName = input.locationName.trim();
  }
  if (input.brandName && input.brandName.trim().length > 0) {
    out.businessName = input.brandName.trim();
  }
  return out;
}

function variantResolves(variant: Variant, resolved: Resolved): boolean {
  return variant.needs.every((k) => typeof resolved[k] === 'string');
}

function substitute(template: string, resolved: Resolved): string {
  return template
    .replace(/\{firstName\}/g, resolved.firstName ?? '')
    .replace(/\{locationName\}/g, resolved.locationName ?? '')
    .replace(/\{businessName\}/g, resolved.businessName ?? '');
}

/**
 * 32-bit FNV-1a hash. Deterministic across runtimes, dependency-free,
 * sufficient for "pick 1 of 5" — collision rate inside a small bucket
 * is irrelevant since collisions just mean "same variant".
 */
function fnv1aHash(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    // 32-bit multiplication: imul keeps it 32-bit safe across V8 / Bun.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
