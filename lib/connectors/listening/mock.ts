import { createHash } from 'node:crypto';

import type {
  ListeningMentionKind,
  ListeningTermKind,
} from '@/lib/db/schema';

/**
 * Listening mock connector (Phase 9 / Commit 33).
 *
 * Deterministic mention generator per Ajuste B — same `(orgId,
 * trackedTermId, dayKey)` produces the same mentions, every time.
 * Tests stay reproducible; the demo shows a consistent feed day
 * to day; the seed gets a stable cross-section of authors and
 * platforms.
 *
 * # Phase 11 swap candidates
 *
 * - **Brand24** (`https://brand24.com`) — full-platform listening
 *   with sentiment + influencer scoring. Pay-per-mention.
 * - **Mention.com** (`https://mention.com`) — Twitter/X + news +
 *   forums. Webhook-driven push model.
 * - **Google Alerts** (RSS-based, free, limited coverage). The
 *   poor-man's fallback for keyword-only listening.
 *
 * Each of these returns roughly the shape this mock emits:
 *   { external_id, author_handle, body, url, captured_at,
 *     platform, kind }
 *
 * Sentiment + intent (lead detection) are NOT part of any of those
 * vendor APIs — we run them ourselves through Phase-7 AI skills
 * (`lib/ai/skills/sentiment`, `lib/ai/skills/intent`).
 *
 * # Determinism
 *
 * The hash blends `(orgId, trackedTermId, isoDayKey)` so:
 *
 *   - Repeated cron ticks on the same UTC day for the same term
 *     converge on the same mention set (idempotent via
 *     `listening_mentions_external_unique`).
 *   - Different days yield different sets — the demo doesn't sit
 *     on a single batch forever.
 *   - The volume range depends on `termKind`:
 *       handle  → 5-20 mentions/day (popular handles)
 *       hashtag → 2-12 mentions/day
 *       keyword → 0-5  mentions/day
 *
 * `now` is injected so tests can pin a fixed clock.
 */

export interface ListeningMockMention {
  readonly externalId: string;
  readonly platform: string;
  readonly authorHandle: string;
  readonly authorDisplayName: string;
  readonly body: string;
  readonly url: string;
  readonly kind: ListeningMentionKind;
  readonly capturedAt: Date;
  /** Pre-computed sentiment for the mock body (not from AI). */
  readonly hintSentiment: 'positive' | 'neutral' | 'negative';
}

export interface ListeningMockScanInput {
  readonly orgId: string;
  readonly trackedTermId: string;
  readonly term: string;
  readonly termKind: ListeningTermKind;
  readonly platforms: ReadonlyArray<string>;
  readonly now: Date;
}

const AUTHORS_POSITIVE: ReadonlyArray<[string, string]> = [
  ['cristina_m', 'Cristina Méndez'],
  ['jorge_lr', 'Jorge L. Ramírez'],
  ['ana_ofc', 'Ana Ortiz'],
  ['pedro_alfaro', 'Pedro Alfaro'],
  ['valeria_t', 'Valeria Torres'],
];
const AUTHORS_NEUTRAL: ReadonlyArray<[string, string]> = [
  ['mariana_lopez', 'Mariana López'],
  ['carlos_re', 'Carlos Reyes'],
  ['rebeca_v', 'Rebeca V'],
  ['oscar_g', 'Óscar Galindo'],
];
const AUTHORS_NEGATIVE: ReadonlyArray<[string, string]> = [
  ['mario_jr', 'Mario Jr.'],
  ['gabriela_s', 'Gabriela Salinas'],
  ['rafa_dgo', 'Rafa Dgo'],
];

const POSITIVE_BODIES = [
  '¡Increíble experiencia con {term}! Recomendado al 100%.',
  'No puedo creer lo buena que es {term}, vale cada peso.',
  'Llevo meses usando {term} y sigue siendo lo mejor que probé.',
];
const NEUTRAL_BODIES = [
  'Alguien sabe si {term} sigue abriendo los domingos?',
  '¿Cómo es la política de devoluciones de {term}?',
  'Buscando opiniones sobre {term}, ¿alguien lo ha usado?',
  'Tengo dudas con {term}, necesito recomendaciones.',
];
const NEGATIVE_BODIES = [
  'Decepcionado con {term}, esperaba mucho más por el precio.',
  '{term} dejó de responder mis mensajes hace 3 días. Pésimo servicio.',
  'No vuelvo a recomendar {term}, una mala experiencia.',
];

const KINDS: ReadonlyArray<ListeningMentionKind> = [
  'post',
  'comment',
  'share',
  'repost',
];

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * 32-bit FNV-1a–style hash from a string + offset. Returns a
 * positive integer suitable for modulo arithmetic. We compose this
 * by hashing `(input)` + `(offset)` so a single seed string can
 * deterministically yield independent pseudo-random pulls.
 */
function hashUint(input: string, offset: number): number {
  const h = createHash('sha256');
  h.update(`${input}|${offset}`);
  const digest = h.digest();
  // Read 4 bytes as uint32 little-endian.
  return digest.readUInt32LE(0);
}

function pickFrom<T>(arr: ReadonlyArray<T>, seed: string, offset: number): T {
  const idx = hashUint(seed, offset) % arr.length;
  return arr[idx]!;
}

function pickRange(seed: string, offset: number, min: number, max: number): number {
  const span = max - min + 1;
  return min + (hashUint(seed, offset) % span);
}

function pickSentiment(
  seed: string,
  offset: number,
): 'positive' | 'neutral' | 'negative' {
  // ~ 40% positive · 35% neutral · 25% negative (broadly realistic).
  const r = hashUint(seed, offset) % 100;
  if (r < 40) return 'positive';
  if (r < 75) return 'neutral';
  return 'negative';
}

/**
 * Run a deterministic scan. Returns the mention list for the
 * given `(org, term, day)` combination; callers persist into
 * `listening_mentions` via `listening_mentions_external_unique`
 * for idempotency.
 *
 * Phase 11 swaps the body of this function with a real connector
 * call (Brand24 / Mention.com). The shape of the returned
 * `ListeningMockMention` is the contract — Phase 11 must hold it
 * stable so persistence + AI pipeline don't change.
 */
export function scanForMentionsMock(
  input: ListeningMockScanInput,
): ReadonlyArray<ListeningMockMention> {
  const seed = `${input.orgId}|${input.trackedTermId}|${dayKey(input.now)}`;

  // Volume range by termKind (Ajuste B).
  const [minN, maxN] =
    input.termKind === 'handle'
      ? [5, 20]
      : input.termKind === 'hashtag'
        ? [2, 12]
        : [0, 5];
  const count = pickRange(seed, 0, minN, maxN);
  if (count === 0) return [];

  const platforms = input.platforms.length > 0 ? input.platforms : ['x'];
  const mentions: ListeningMockMention[] = [];
  const baseTime = new Date(input.now.getTime() - 60 * 60_000);

  for (let i = 0; i < count; i += 1) {
    const sub = `${seed}|${i}`;
    const sentiment = pickSentiment(sub, 0);
    const authors =
      sentiment === 'positive'
        ? AUTHORS_POSITIVE
        : sentiment === 'negative'
          ? AUTHORS_NEGATIVE
          : AUTHORS_NEUTRAL;
    const author = pickFrom(authors, sub, 1);
    const platform = pickFrom(platforms, sub, 2);
    const bodyTemplate =
      sentiment === 'positive'
        ? pickFrom(POSITIVE_BODIES, sub, 3)
        : sentiment === 'negative'
          ? pickFrom(NEGATIVE_BODIES, sub, 3)
          : pickFrom(NEUTRAL_BODIES, sub, 3);
    const kind = pickFrom(KINDS, sub, 4);
    const offsetMin = pickRange(sub, 5, 0, 60 * 24);
    const capturedAt = new Date(baseTime.getTime() - offsetMin * 60_000);
    const externalId = `listening-mock-${platform}-${input.trackedTermId.slice(0, 8)}-${dayKey(input.now)}-${i}`;
    mentions.push({
      externalId,
      platform,
      authorHandle: author[0],
      authorDisplayName: author[1],
      body: bodyTemplate.replace('{term}', input.term),
      url: `https://mock.${platform}.example.com/posts/${externalId}`,
      kind,
      capturedAt,
      hintSentiment: sentiment,
    });
  }
  return mentions;
}
