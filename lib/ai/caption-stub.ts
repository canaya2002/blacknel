/**
 * Phase-6 caption-suggestion stub.
 *
 * Deterministic — same `(postId, brandId, index)` always returns
 * the same caption. Phase 7 swaps this for a `claude-haiku-4-5`
 * call through `lib/ai/client.ts` with prompt caching; the
 * public surface (`suggestCaptionStub` + the in/out shapes)
 * stays the same so the composer doesn't need to change.
 *
 * # Algorithm
 *
 *   1. Bucket by `(goal × tone)`. ~13 explicit pairs are
 *      populated; the rest fall back to `evergreen × friendly`.
 *   2. Within the bucket, pick variant at
 *      `(fnv1aHash(postId + ':' + brandId) + index) %
 *       variants.length`. The `index` parameter cycles for the
 *      "Otra opción" regenerate button.
 *   3. Substitute `{brandName}` / `{locationName}` /
 *      `{productHint}` from input. If the chosen variant
 *      references an unresolvable variable, fall back to the
 *      bucket's first variant (which always has `needs: []`)
 *      until a fit is found.
 *
 * # Why this shape
 *
 *   - **Determinism** for tests + audit log integrity.
 *   - **Variety per org** — different posts land on different
 *     variants; the demo composer doesn't read like a single
 *     copy-pasted line.
 *   - **No real-time dependency** (no `Math.random`, no
 *     `Date.now`).
 */

export type CampaignGoal =
  | 'awareness'
  | 'engagement'
  | 'leads'
  | 'reviews'
  | 'reputation'
  | 'event'
  | 'launch'
  | 'promotion'
  | 'education'
  | 'crisis'
  | 'seasonal'
  | 'evergreen';

export type BrandTone =
  | 'formal'
  | 'friendly'
  | 'professional'
  | 'playful'
  | 'premium'
  | 'warm'
  | 'institutional'
  | 'concise';

export interface SuggestCaptionInput {
  readonly postId: string;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly locationName: string | null;
  readonly productHint: string | null;
  readonly goal: CampaignGoal;
  readonly tone: BrandTone;
  /** Regenerate cycle index — 0 for the first suggestion, 1 for the
   *  first "Otra opción", etc. */
  readonly index?: number;
}

export interface SuggestCaptionOutput {
  readonly body: string;
  readonly variantIndex: number;
  /** `${goal}_${tone}` actually applied (after fallback). */
  readonly bucket: string;
  readonly resolvedVariables: ReadonlyArray<VariableKey>;
  readonly unresolvedVariables: ReadonlyArray<VariableKey>;
  /** True when the requested bucket had no entries and we fell back. */
  readonly fellBackToDefault: boolean;
}

type VariableKey = 'brandName' | 'locationName' | 'productHint';

interface Variant {
  readonly text: string;
  /** Variables the template references. The first variant of every
   *  bucket has `needs: []` so it ALWAYS resolves. */
  readonly needs: ReadonlyArray<VariableKey>;
}

// ---------------------------------------------------------------------------
// Bucket population
// ---------------------------------------------------------------------------

const DEFAULT_BUCKET_KEY = 'evergreen_friendly';

/** Composite key for the matrix. */
function bucketKey(goal: CampaignGoal, tone: BrandTone): string {
  return `${goal}_${tone}`;
}

const BUCKETS: Readonly<Record<string, ReadonlyArray<Variant>>> = {
  // ----- Evergreen × Friendly (the fallback bucket) ----------------
  evergreen_friendly: [
    { text: '¿Y tú, qué planes tienes hoy? Cuéntanos en los comentarios.', needs: [] },
    { text: '¡Hola, {brandName}! Estamos listos para servirte hoy.', needs: ['brandName'] },
    {
      text: 'Visítanos en {locationName} y descubre por qué somos parte de la rutina de tantas personas.',
      needs: ['locationName'],
    },
    {
      text: 'Una sonrisa empieza con algo bien hecho. {brandName} te lo asegura cada día.',
      needs: ['brandName'],
    },
    {
      text: '{productHint}: una de nuestras especialidades. Pasa a probarlo cuando quieras.',
      needs: ['productHint'],
    },
    { text: 'Pequeños momentos, buenos detalles. Eso es lo que hacemos aquí.', needs: [] },
  ],

  // ----- Promotion × Friendly -------------------------------------
  promotion_friendly: [
    { text: '¡Oferta del día! Aprovecha antes de que se acabe.', needs: [] },
    {
      text: 'Esta semana en {brandName}: descuentos pensados para que disfrutes más.',
      needs: ['brandName'],
    },
    {
      text: '¿Buscabas una razón para visitarnos? Aquí va: estamos en oferta en {locationName}.',
      needs: ['locationName'],
    },
    {
      text: '{productHint} con descuento por tiempo limitado. ¿Te animas?',
      needs: ['productHint'],
    },
    { text: 'Promociones nuevas cada semana. Síguenos para no perderlas.', needs: [] },
  ],

  // ----- Promotion × Professional --------------------------------
  promotion_professional: [
    {
      text: 'Promoción especial vigente esta semana. Consulta términos y condiciones en nuestro sitio.',
      needs: [],
    },
    {
      text: 'En {brandName}, esta semana presentamos una promoción seleccionada para nuestros clientes frecuentes.',
      needs: ['brandName'],
    },
    {
      text: 'Visite {locationName} entre lunes y viernes para acceder a precios preferenciales.',
      needs: ['locationName'],
    },
    {
      text: 'Promoción aplicable a {productHint} mientras dure el inventario.',
      needs: ['productHint'],
    },
    { text: 'Una oportunidad por temporada. Aproveche antes del cierre del período.', needs: [] },
  ],

  // ----- Launch × Friendly ---------------------------------------
  launch_friendly: [
    { text: '🎉 ¡Tenemos algo nuevo! Te contamos los detalles aquí.', needs: [] },
    {
      text: '{brandName} estrena lo que has estado esperando. Vente a probarlo.',
      needs: ['brandName'],
    },
    {
      text: 'Llegó {productHint} a {locationName}. ¿Quién se anima primero?',
      needs: ['productHint', 'locationName'],
    },
    {
      text: 'Por fin: presentamos {productHint}. Disponible desde ya.',
      needs: ['productHint'],
    },
    { text: 'Lanzamiento de la semana. Etiqueta a alguien con quien lo disfrutarías.', needs: [] },
  ],

  // ----- Launch × Premium ----------------------------------------
  launch_premium: [
    {
      text: 'Presentamos una nueva propuesta. Pensada para los detalles, hecha para quien los aprecia.',
      needs: [],
    },
    {
      text: 'En {brandName}, hoy revelamos una colección creada con calma y precisión.',
      needs: ['brandName'],
    },
    {
      text: 'Una experiencia inédita aterriza en {locationName}. Reserva tu lugar.',
      needs: ['locationName'],
    },
    {
      text: '{productHint}: cada elemento elegido con intención. Disponible por tiempo limitado.',
      needs: ['productHint'],
    },
    { text: 'Algo distinto. Algo cuidado. Algo nuestro.', needs: [] },
  ],

  // ----- Engagement × Playful ------------------------------------
  engagement_playful: [
    { text: '¿Cuál prefieres? 🤔 1 o 2? Coméntalo abajo.', needs: [] },
    {
      text: '¡Equipo {brandName}, encuentro a la cuenta de 3! ¿Listos? 🚀',
      needs: ['brandName'],
    },
    {
      text: '{locationName}, ¿cuál es tu rincón favorito? Foto en los comentarios.',
      needs: ['locationName'],
    },
    {
      text: '{productHint} o el otro {productHint}? Decisión imposible. Vota 👇',
      needs: ['productHint'],
    },
    { text: 'Trivia rápida: ¿quién acierta primero?', needs: [] },
  ],

  // ----- Engagement × Friendly -----------------------------------
  engagement_friendly: [
    { text: '¿Qué planes tienes para hoy? Cuéntanos en los comentarios.', needs: [] },
    {
      text: 'Hola, comunidad {brandName}: queremos saber qué es lo que más disfrutan de nosotros.',
      needs: ['brandName'],
    },
    {
      text: 'Si pudieras quedarte una tarde entera en {locationName}, ¿qué harías?',
      needs: ['locationName'],
    },
    {
      text: '{productHint} con tu café de la mañana — ¿sí o no? Nos interesa tu opinión.',
      needs: ['productHint'],
    },
    { text: 'Pregunta para empezar la conversación: ¿qué te trajo aquí hoy?', needs: [] },
  ],

  // ----- Awareness × Warm ----------------------------------------
  awareness_warm: [
    {
      text: 'A veces lo más importante está en lo cotidiano. Eso es lo que hacemos.',
      needs: [],
    },
    {
      text: 'En {brandName} llevamos años cuidando los detalles que importan.',
      needs: ['brandName'],
    },
    {
      text: 'Nos encontramos en {locationName} y esperamos verte pronto.',
      needs: ['locationName'],
    },
    {
      text: 'Cuando hablamos de {productHint}, lo decimos en serio.',
      needs: ['productHint'],
    },
    { text: 'Aquí estamos. Pasa cuando quieras.', needs: [] },
  ],

  // ----- Awareness × Institutional -------------------------------
  awareness_institutional: [
    {
      text: 'Comprometidos con la calidad, la consistencia y el servicio. Esa es nuestra propuesta.',
      needs: [],
    },
    {
      text: '{brandName} mantiene un estándar de servicio que respaldamos con resultados.',
      needs: ['brandName'],
    },
    {
      text: 'En {locationName} atendemos con la misma seriedad que define a la marca.',
      needs: ['locationName'],
    },
    {
      text: '{productHint} cumple con los lineamientos de calidad de nuestra organización.',
      needs: ['productHint'],
    },
    { text: 'Hechos, no promesas. Eso es lo que ofrecemos.', needs: [] },
  ],

  // ----- Reviews × Friendly --------------------------------------
  reviews_friendly: [
    { text: '¡Tu opinión nos importa! Cuéntanos qué te pareció tu visita.', needs: [] },
    {
      text: 'Si {brandName} te dejó una buena impresión, una reseña ayuda mucho.',
      needs: ['brandName'],
    },
    {
      text: '¿Pasaste por {locationName}? Nos encantaría leer cómo te fue.',
      needs: ['locationName'],
    },
    {
      text: 'Tu reseña sobre {productHint} ayuda a más personas a animarse a probarlo.',
      needs: ['productHint'],
    },
    { text: 'Comparte tu experiencia y ayuda a otros a decidirse.', needs: [] },
  ],

  // ----- Event × Friendly ----------------------------------------
  event_friendly: [
    { text: '¡Nos vemos este fin de semana! Marca la fecha en tu calendario.', needs: [] },
    {
      text: 'Te esperamos en el próximo evento de {brandName}. Habrá sorpresas.',
      needs: ['brandName'],
    },
    {
      text: 'Sábado en {locationName}: día especial, ambiente relajado, todos invitados.',
      needs: ['locationName'],
    },
    {
      text: 'Demo de {productHint} este fin de semana. Trae a alguien que quieras sorprender.',
      needs: ['productHint'],
    },
    { text: 'Etiqueta a la persona con la que irías. Te leemos.', needs: [] },
  ],

  // ----- Seasonal × Warm -----------------------------------------
  seasonal_warm: [
    { text: 'Llegaron los días favoritos del año. Aquí estamos para acompañarte.', needs: [] },
    {
      text: 'Cada temporada en {brandName} viene con algo nuevo. Esta no es la excepción.',
      needs: ['brandName'],
    },
    {
      text: 'En {locationName} la temporada se siente diferente. Ven y compruébalo.',
      needs: ['locationName'],
    },
    {
      text: '{productHint} de temporada: solo unos meses al año.',
      needs: ['productHint'],
    },
    { text: 'Aprovecha mientras dure. Es lo que tiene lo bueno.', needs: [] },
  ],

  // ----- Education × Professional --------------------------------
  education_professional: [
    {
      text: 'Información útil para tomar mejores decisiones. Hilo abajo 👇',
      needs: [],
    },
    {
      text: '{brandName} comparte con la comunidad lo que hemos aprendido a lo largo de los años.',
      needs: ['brandName'],
    },
    {
      text: 'En {locationName} ofrecemos asesoría sin compromiso. Pregunta lo que necesites.',
      needs: ['locationName'],
    },
    {
      text: 'Todo lo que debes saber sobre {productHint} antes de elegir. Resumen rápido a continuación.',
      needs: ['productHint'],
    },
    { text: 'Tres puntos importantes antes de decidir. Sigue leyendo.', needs: [] },
  ],
};

// Sanity check: all buckets have at least one fallback-safe variant.
for (const [key, variants] of Object.entries(BUCKETS)) {
  if (variants.length === 0 || (variants[0]?.needs.length ?? 0) !== 0) {
    throw new Error(
      `caption-stub: bucket ${key} must start with a no-needs variant.`,
    );
  }
}

// ---------------------------------------------------------------------------
// FNV-1a hash (same pattern as reviews-stub.ts)
// ---------------------------------------------------------------------------

/**
 * 32-bit FNV-1a — fast, pure, no crypto needed. Deterministic
 * across runs / processes / OSes.
 */
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime via add+shift trick to stay within 32-bit range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a stub caption suggestion. Same input → same output.
 * Increment `index` for the regenerate cycle.
 */
export function suggestCaptionStub(input: SuggestCaptionInput): SuggestCaptionOutput {
  const requestedKey = bucketKey(input.goal, input.tone);
  const requestedBucket = BUCKETS[requestedKey];
  const fellBackToDefault = requestedBucket === undefined;
  const bucket = requestedBucket ?? BUCKETS[DEFAULT_BUCKET_KEY]!;
  const appliedKey = requestedBucket ? requestedKey : DEFAULT_BUCKET_KEY;

  const index = Math.max(0, Math.floor(input.index ?? 0));
  const seed = fnv1aHash(`${input.postId}:${input.brandId ?? ''}`) + index;
  let chosenIdx = seed % bucket.length;

  const available: Set<VariableKey> = new Set();
  if (input.brandName && input.brandName.trim().length > 0) available.add('brandName');
  if (input.locationName && input.locationName.trim().length > 0) available.add('locationName');
  if (input.productHint && input.productHint.trim().length > 0) available.add('productHint');

  // If the chosen variant references a missing variable, fall back
  // to the first variant in the bucket (needs=[], always safe).
  let chosen = bucket[chosenIdx]!;
  const fitsNeeds = (v: Variant): boolean => v.needs.every((k) => available.has(k));
  if (!fitsNeeds(chosen)) {
    chosen = bucket[0]!;
    chosenIdx = 0;
  }

  const body = substituteVariables(chosen.text, {
    brandName: input.brandName ?? '',
    locationName: input.locationName ?? '',
    productHint: input.productHint ?? '',
  });

  const resolved: VariableKey[] = chosen.needs.filter((k) => available.has(k));
  const unresolved: VariableKey[] = chosen.needs.filter((k) => !available.has(k));

  return {
    body,
    variantIndex: chosenIdx,
    bucket: appliedKey,
    resolvedVariables: resolved,
    unresolvedVariables: unresolved,
    fellBackToDefault,
  };
}

function substituteVariables(
  template: string,
  vars: Record<VariableKey, string>,
): string {
  return template
    .replaceAll('{brandName}', vars.brandName)
    .replaceAll('{locationName}', vars.locationName)
    .replaceAll('{productHint}', vars.productHint);
}

/**
 * Normalises an arbitrary `brand_voices.tone` text to a known
 * `BrandTone`. Unknown values map to `'friendly'`, the most
 * neutral default.
 */
export function normalizeTone(raw: string | null | undefined): BrandTone {
  if (!raw) return 'friendly';
  const lower = raw.trim().toLowerCase();
  switch (lower) {
    case 'formal':
    case 'friendly':
    case 'professional':
    case 'playful':
    case 'premium':
    case 'warm':
    case 'institutional':
    case 'concise':
      return lower;
    default:
      return 'friendly';
  }
}
