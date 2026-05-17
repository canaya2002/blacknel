import { createHash } from 'node:crypto';

import type { PlatformCode } from './types';

/**
 * Phase 10 / Commit 38 — deterministic review generator shared by
 * the 5 Enterprise platform mocks (yelp, tripadvisor, trustpilot,
 * bbb, avvo).
 *
 * Each mock connector calls `generateReviewsForDay(input)` with
 * its platform + account scope. The function returns a stable
 * `(orgId, accountId, day, platform)` → review set. Volume
 * bands per platform reflect realistic vertical activity:
 *
 *   yelp        → 0-5 reviews/day  (restaurant scale)
 *   tripadvisor → 1-10 reviews/day (hotel)
 *   trustpilot  → 2-15 reviews/day (e-commerce)
 *   bbb         → 0-2 complaints/day (different cadence)
 *   avvo        → 0-1 reviews/day (low volume legal)
 *
 * Sentiment + rating + platform-specific fields all derive
 * deterministically from the (org, account, day) seed.
 */

export interface GenerateReviewsInput {
  readonly orgId: string;
  readonly accountId: string;
  readonly day: string; // ISO `YYYY-MM-DD`
  readonly platform: PlatformCode;
}

export interface MockReview {
  readonly externalId: string;
  readonly authorName: string;
  readonly rating: number | null; // BBB → null (complaint, not review)
  readonly body: string;
  readonly sentiment: 'positive' | 'neutral' | 'negative';
  readonly postedAt: Date;
  readonly platformSpecific: Record<string, unknown>;
}

const AUTHORS = [
  'Carolina M.',
  'Diego R.',
  'Mariana S.',
  'Pedro L.',
  'Ana T.',
  'Roberto V.',
  'Sofía P.',
  'Lucas H.',
];

const POSITIVE_BODIES = [
  'Excelente experiencia. Volvería sin dudar.',
  'Servicio impecable, recomendado al 100%.',
  'Calidad muy por encima del promedio.',
];
const NEUTRAL_BODIES = [
  'Estuvo bien. Cumple expectativas básicas.',
  'Servicio correcto. Nada especial pero sin quejas.',
];
const NEGATIVE_BODIES = [
  'Mala experiencia. No volvería.',
  'Tardaron mucho y la calidad no justifica el precio.',
  'Problemas de servicio que no fueron resueltos a tiempo.',
];

const BBB_COMPLAINT_BODIES = [
  'Cargo en la tarjeta sin autorización. Esperando reembolso.',
  'Producto recibido dañado. La empresa no responde mensajes.',
  'Servicio cancelado unilateralmente sin reembolso del depósito.',
  'Publicidad engañosa: lo prometido no coincide con lo recibido.',
];

const BBB_COMPLAINT_TYPES = [
  'product',
  'service',
  'billing',
  'advertising',
  'sales',
] as const;

const BBB_STATUSES = ['pending', 'assigned', 'resolved', 'closed'] as const;

const AVVO_CASE_TYPES = [
  'family_law',
  'criminal',
  'personal_injury',
  'estate_planning',
  'business',
  'immigration',
] as const;

const VOLUME_BANDS: Record<PlatformCode, [number, number]> = {
  yelp: [0, 5],
  tripadvisor: [1, 10],
  trustpilot: [2, 15],
  bbb: [0, 2],
  avvo: [0, 1],
  // Other platforms are not driven by this generator; sane fallback.
  facebook: [0, 3],
  instagram: [0, 3],
  gbp: [0, 3],
  whatsapp: [0, 0],
  tiktok: [0, 2],
  linkedin: [0, 2],
  x: [0, 5],
  youtube: [0, 2],
  pinterest: [0, 2],
  reddit: [0, 5],
  mock: [0, 0],
};

function hashUint(input: string, offset: number): number {
  const h = createHash('sha256');
  h.update(`${input}|${offset}`);
  return h.digest().readUInt32LE(0);
}

function pickRange(seed: string, offset: number, min: number, max: number): number {
  const span = max - min + 1;
  return min + (hashUint(seed, offset) % span);
}

function pick<T>(arr: ReadonlyArray<T>, seed: string, offset: number): T {
  return arr[hashUint(seed, offset) % arr.length]!;
}

function pickSentiment(
  seed: string,
  offset: number,
): 'positive' | 'neutral' | 'negative' {
  const r = hashUint(seed, offset) % 100;
  if (r < 50) return 'positive';
  if (r < 80) return 'neutral';
  return 'negative';
}

export function generateReviewsForDay(
  input: GenerateReviewsInput,
): ReadonlyArray<MockReview> {
  const [minN, maxN] = VOLUME_BANDS[input.platform] ?? [0, 0];
  const seed = `${input.platform}|${input.orgId}|${input.accountId}|${input.day}`;
  const count = pickRange(seed, 0, minN, maxN);
  if (count === 0) return [];

  const dayStart = new Date(`${input.day}T00:00:00Z`);
  const out: MockReview[] = [];

  for (let i = 0; i < count; i += 1) {
    const sub = `${seed}|${i}`;
    const externalId = `${input.platform}-${input.accountId.slice(0, 8)}-${input.day}-${i}`;
    const author = pick(AUTHORS, sub, 1);
    const minuteOffset = pickRange(sub, 2, 0, 60 * 23);
    const postedAt = new Date(dayStart.getTime() + minuteOffset * 60_000);

    if (input.platform === 'bbb') {
      // BBB: complaint, not review (Ajuste 2 lifecycle).
      const complaintType = pick(BBB_COMPLAINT_TYPES, sub, 3);
      const complaintStatus = pick(BBB_STATUSES, sub, 4);
      const body = pick(BBB_COMPLAINT_BODIES, sub, 5);
      const caseId = `BBB-${input.day.replace(/-/g, '')}-${i}`;
      const resolutionSummary =
        complaintStatus === 'resolved' || complaintStatus === 'closed'
          ? 'Reembolso emitido + apology dispatched within 5 días.'
          : null;
      out.push({
        externalId,
        authorName: author,
        rating: null,
        body,
        sentiment: 'negative',
        postedAt,
        platformSpecific: {
          complaint_type: complaintType,
          complaint_status: complaintStatus,
          case_id: caseId,
          resolution_summary: resolutionSummary,
          filed_at: postedAt.toISOString(),
        },
      });
      continue;
    }

    // Standard review platforms (yelp / tripadvisor / trustpilot / avvo).
    const sentiment = pickSentiment(sub, 3);
    const rating =
      sentiment === 'positive'
        ? pickRange(sub, 4, 4, 5)
        : sentiment === 'neutral'
          ? 3
          : pickRange(sub, 4, 1, 2);
    const body =
      sentiment === 'positive'
        ? pick(POSITIVE_BODIES, sub, 5)
        : sentiment === 'negative'
          ? pick(NEGATIVE_BODIES, sub, 5)
          : pick(NEUTRAL_BODIES, sub, 5);

    let platformSpecific: Record<string, unknown> = {};

    if (input.platform === 'yelp') {
      platformSpecific = {
        elite_reviewer: hashUint(sub, 7) % 10 === 0, // ~10% elite
        response_window_hours: pickRange(sub, 8, 1, 72),
      };
    } else if (input.platform === 'tripadvisor') {
      platformSpecific = {
        traveler_choice: hashUint(sub, 7) % 15 === 0, // ~7%
        category_ratings: {
          food: rating ?? 3,
          service: rating ?? 3,
          value:
            rating !== null
              ? Math.max(1, rating - (hashUint(sub, 9) % 2))
              : 3,
          atmosphere:
            rating !== null
              ? Math.min(5, rating + (hashUint(sub, 10) % 2))
              : 3,
        },
      };
    } else if (input.platform === 'trustpilot') {
      platformSpecific = {
        verified_buyer: hashUint(sub, 7) % 3 !== 0, // ~66%
        business_trust_score:
          Math.round((3.5 + (hashUint(sub, 8) % 150) / 100) * 100) / 100,
        invitation_based: hashUint(sub, 9) % 2 === 0,
      };
    } else if (input.platform === 'avvo') {
      platformSpecific = {
        case_type: pick(AVVO_CASE_TYPES, sub, 7),
        client_testimonial: hashUint(sub, 8) % 4 === 0,
        attorney_response_count: pickRange(sub, 9, 0, 3),
      };
    }

    out.push({
      externalId,
      authorName: author,
      rating,
      body,
      sentiment,
      postedAt,
      platformSpecific,
    });
  }
  return out;
}
