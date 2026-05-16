import 'server-only';

import { reviewResponses, reviews } from './schema';
import { SEED_IDS } from './seed';

import type { AnyPgTx } from './client';

/**
 * Phase-5 reviews seed. 80 reviews across the 5 demo locations and 5
 * platforms (facebook, gbp, yelp, tripadvisor, trustpilot), shaped to
 * test the surface end-to-end:
 *
 *   - Rating mix:  15% 1-2★ (negative)  /  25% 3★ (mixed)  /  60% 4-5★
 *                  (positive). This drives the approval-flow scenarios
 *                  in Commit 14 (rating ≤3 auto-routes to approval).
 *
 *   - Temporal mix:  60% in the last 14 days  /  25% in days 15-30  /
 *                    15% in days 31-90. Gives Commit 15 a realistic
 *                    curve when plotting the rating trend.
 *
 *   - Response mix: ~40% have a published response, ~30% are pending
 *                   (no response yet), the rest are in_progress /
 *                   archived. Mirrors a typical "we respond to most
 *                   reviews but always have a backlog" reality.
 *
 *   - Yelp included on purpose. The demo org runs on Growth, which
 *     does NOT include Yelp (gated to Enterprise per `lib/plans/plans.ts`).
 *     Commit 13's filters drop Yelp out of the platform pick-list and
 *     show an Upgrade prompt — but the rows exist in the DB so the
 *     gating itself can be tested end-to-end.
 *
 *   - CRISIS SPIKE (Phase-7 hook): 5 negative reviews (1-2★) on the
 *     SAME location ("Trattoria Downtown") concentrated in the last
 *     3 days. This is the canonical scenario the future crisis-
 *     detection job (Phase 7) will fire on. Documented here so it's
 *     never accidentally smoothed out by a later seed re-balance.
 *
 * Deterministic via a tiny LCG, matching `seed-inbox.ts`.
 * Idempotent: `ON CONFLICT DO NOTHING` on the primary key.
 */

const ORG = SEED_IDS.org.demo;
const NOW = new Date('2026-05-15T16:00:00Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

const PLATFORMS = ['facebook', 'gbp', 'yelp', 'tripadvisor', 'trustpilot'] as const;

const LOCATIONS = [
  { id: SEED_IDS.location.trattoriaDowntown, brandId: SEED_IDS.brand.trattoria },
  { id: SEED_IDS.location.trattoriaNorth, brandId: SEED_IDS.brand.trattoria },
  { id: SEED_IDS.location.trattoriaMall, brandId: SEED_IDS.brand.trattoria },
  { id: SEED_IDS.location.clinicaCentral, brandId: SEED_IDS.brand.clinica },
  { id: SEED_IDS.location.clinicaWest, brandId: SEED_IDS.brand.clinica },
] as const;

const AUTHOR_NAMES = [
  'Marta Velasco', 'Luis Pérez', 'Carolina Lara', 'Andrés Saldaña',
  'Pilar Domínguez', 'Esteban Vargas', 'Camila Ríos', 'Daniel Acosta',
  'Lorena Morales', 'Marcelo Quintero', 'Fátima Aranda', 'Iván Castaño',
  'Renata Solís', 'Beatriz Higuera', 'Gerardo Vega', 'Liliana Mora',
];

const POSITIVE_BODIES = [
  'Excelente experiencia, el personal súper atento y el lugar muy limpio.',
  'Volveré sin duda. La calidad y atención superaron mis expectativas.',
  'Recomendado al 100%. Tiempos de espera cortos y todo muy bien resuelto.',
  '¡Increíble! Muy contentos con el resultado. Gracias al equipo.',
  'Servicio rápido, ambiente cálido, precios justos. Top.',
];
const MIXED_BODIES = [
  'El servicio bien pero la espera fue larga, casi 40 minutos.',
  'Estuvo ok. Comida correcta, ambiente algo ruidoso esa noche.',
  'Buena atención del personal aunque podrían mejorar el aseo.',
  'Esperaba más por el precio. No malo, pero tampoco memorable.',
];
const NEGATIVE_BODIES = [
  'Mala atención. Pedí reembolso por el cobro extra y nadie respondió.',
  'No volvería. El personal fue grosero y la comida tardó casi una hora.',
  'Decepcionante. Promesas que no cumplen, mi cita se atrasó dos veces.',
  'Pésimo servicio. El gerente nunca dio la cara para resolver mi queja.',
  'Mal manejo de la situación, exigí hablar con el responsable y nada.',
  'Frustrante. Cobraron de más y se negaron a corregir la factura.',
];

const REVIEW_TAGS = ['servicio', 'limpieza', 'precio', 'personal', 'tiempo-espera', 'ambiente'];

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function pick<T>(rnd: () => number, list: ReadonlyArray<T>): T {
  return list[Math.floor(rnd() * list.length)]!;
}

function uuidReview(i: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-9${String(i).padStart(11, '0')}`;
}
function uuidResponse(i: number): string {
  return `cccccccc-cccc-4ccc-8ccc-9${String(i).padStart(11, '0')}`;
}

/**
 * Decide an `ageDays` value following the 60/25/15 temporal mix.
 * Index `i` is used so a re-run with a fixed seed gets a stable answer.
 */
function ageDaysFor(i: number, rnd: () => number): number {
  const roll = Math.floor(rnd() * 100);
  if (roll < 60) {
    // last 14 days
    return Math.floor(rnd() * 14);
  }
  if (roll < 85) {
    // days 15-30
    return 14 + Math.floor(rnd() * 16);
  }
  // days 31-90
  return 30 + Math.floor(rnd() * 60);
}

function ratingFor(i: number, rnd: () => number): number {
  const roll = Math.floor(rnd() * 100);
  if (roll < 15) {
    // 1-2 stars (negative)
    return rnd() < 0.5 ? 1 : 2;
  }
  if (roll < 40) {
    // 3 stars (mixed)
    return 3;
  }
  // 4-5 stars (positive)
  return rnd() < 0.5 ? 4 : 5;
}

function sentimentForRating(rating: number): 'positive' | 'neutral' | 'negative' | 'unknown' {
  if (rating <= 2) return 'negative';
  if (rating === 3) return 'neutral';
  return 'positive';
}

function bodyForRating(rating: number, rnd: () => number): string {
  if (rating <= 2) return pick(rnd, NEGATIVE_BODIES);
  if (rating === 3) return pick(rnd, MIXED_BODIES);
  return pick(rnd, POSITIVE_BODIES);
}

export async function seedReviews(tx: AnyPgTx): Promise<void> {
  const reviewRows: Array<typeof reviews.$inferInsert> = [];
  const responseRows: Array<typeof reviewResponses.$inferInsert> = [];

  // ---- 75 normal reviews ------------------------------------------------
  // We hand-craft the last 5 below as the crisis spike so the
  // distribution targets stay clean.
  for (let i = 1; i <= 75; i++) {
    const rnd = lcg(i * 97 + 11);
    const platform = pick(rnd, PLATFORMS);
    const location = pick(rnd, LOCATIONS);
    const rating = ratingFor(i, rnd);
    const body = bodyForRating(rating, rnd);
    const ageD = ageDaysFor(i, rnd);
    const postedAt = new Date(NOW - ageD * DAY_MS - Math.floor(rnd() * DAY_MS));
    const authorName = pick(rnd, AUTHOR_NAMES);

    const tagsCount = Math.floor(rnd() * 3); // 0..2
    const tags: string[] = [];
    for (let t = 0; t < tagsCount; t++) {
      const tag = pick(rnd, REVIEW_TAGS);
      if (!tags.includes(tag)) tags.push(tag);
    }

    // Status / assignment distribution.
    const respRoll = rnd();
    let status: 'pending' | 'in_progress' | 'responded' | 'archived';
    let assignedTo: string | null = null;
    if (respRoll < 0.4) {
      status = 'responded';
      assignedTo = SEED_IDS.user.manager;
    } else if (respRoll < 0.55) {
      status = 'in_progress';
      assignedTo = pick(rnd, [SEED_IDS.user.agent, SEED_IDS.user.admin1]);
    } else if (respRoll < 0.95) {
      status = 'pending';
    } else {
      status = 'archived';
    }

    const id = uuidReview(i);
    reviewRows.push({
      id,
      organizationId: ORG,
      brandId: location.brandId,
      locationId: location.id,
      platform,
      externalReviewId: `${platform}-rev-${i}`,
      authorName,
      authorAvatar: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(authorName)}`,
      rating,
      body,
      language: 'es',
      postedAt,
      sentiment: sentimentForRating(rating),
      status,
      assignedTo,
      escalated: rating <= 2 && rnd() < 0.3, // 30% of negatives are escalated
      tags,
    });

    if (status === 'responded') {
      responseRows.push({
        id: uuidResponse(i),
        organizationId: ORG,
        reviewId: id,
        draftText: null,
        finalText:
          rating >= 4
            ? `Gracias por tu reseña, ${authorName.split(' ')[0]}! Nos alegra mucho saberlo.`
            : `Lamentamos la experiencia, ${authorName.split(' ')[0]}. Un manager te contactará para resolver el caso.`,
        status: 'published',
        authorId: SEED_IDS.user.manager,
        aiGenerated: false,
        publishedAt: new Date(postedAt.getTime() + 4 * 60 * 60 * 1000), // 4h after the review
      });
    }
  }

  // ---- 5 crisis-spike negative reviews on Trattoria Downtown ----------
  // All in the last 3 days, ratings 1-2, on a single location. Tests
  // and Phase-7 crisis detection rely on this spike — DO NOT smooth
  // it out by tweaking the distribution above.
  for (let i = 0; i < 5; i++) {
    const idx = 76 + i;
    const rnd = lcg(idx * 53 + 31);
    const platform = pick(rnd, PLATFORMS);
    const rating = (rnd() < 0.5 ? 1 : 2) as 1 | 2;
    const postedAt = new Date(NOW - (Math.floor(rnd() * 72)) * 60 * 60 * 1000); // last 0-72h
    const authorName = pick(rnd, AUTHOR_NAMES);
    const id = uuidReview(idx);
    reviewRows.push({
      id,
      organizationId: ORG,
      brandId: SEED_IDS.brand.trattoria,
      locationId: SEED_IDS.location.trattoriaDowntown,
      platform,
      externalReviewId: `${platform}-rev-${idx}`,
      authorName,
      authorAvatar: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(authorName)}`,
      rating,
      body: pick(rnd, NEGATIVE_BODIES),
      language: 'es',
      postedAt,
      sentiment: 'negative',
      status: 'pending',
      assignedTo: null,
      escalated: false,
      tags: ['servicio'],
    });
  }

  await tx.insert(reviews).values(reviewRows).onConflictDoNothing({ target: reviews.id });

  if (responseRows.length > 0) {
    await tx
      .insert(reviewResponses)
      .values(responseRows)
      .onConflictDoNothing({ target: reviewResponses.id });
  }
}
