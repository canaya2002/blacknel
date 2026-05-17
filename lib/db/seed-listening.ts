import 'server-only';

import { sql } from 'drizzle-orm';

import {
  listeningMentions,
  listeningTrackedTerms,
} from './schema';
import { SEED_IDS } from './seed';

import type { AnyPgTx } from './client';

/**
 * Listening demo seed (Phase 9 / Commit 33).
 *
 * # R-33-1 invariant
 *
 * Sentiments and `is_lead` are **pre-classified** to keep the seed
 * deterministic and side-effect-free. **The AI sentiment + intent
 * skills are only invoked by the listening-scan cron when new
 * mentions arrive at runtime** — never from this file. Two
 * reasons:
 *
 *   1. The seed runs on every dev boot. Pinging the (mock) AI
 *      adapter on every boot would noise up `ai_generations` and
 *      mask real usage signals when the live API arrives in
 *      Phase 11.
 *
 *   2. Tests run with the seed off (`BLACKNEL_SEED_LISTENING=false`
 *      via `tests/helpers/react-act-setup.ts`), but a developer
 *      switching the gate on must not pay a per-row AI call.
 *
 * # What lands
 *
 *   - 4 tracked terms per demo org (one per kind to cover the
 *     full enum):
 *       - keyword 'la trattoria' on x/instagram (active)
 *       - hashtag '#consultaSolis' on x/facebook (active)
 *       - handle  '@latrattoria_mx' on x/instagram/tiktok (active)
 *       - keyword 'clinica solis' on x/reddit (paused — empty mentions)
 *
 *   - 80 mentions distributed across the 3 active terms. Sentiment
 *     mix ~40/35/25 (positive/neutral/negative); ~15% marked
 *     `is_lead=true` to make the Leads tab non-empty.
 *
 *   - One mention pre-assigned to a fresh inbox_thread to show the
 *     converted state in the demo. Wired by inserting both rows
 *     and stamping `assigned_thread_id` + `inbox_threads.source_
 *     mention_id` — the bidirectional FK pair from the R-33-2
 *     charter touch.
 */

const ORG = SEED_IDS.org.demo;

const TERM_IDS = {
  trattoria: '88888888-8888-4888-8888-000000033001',
  hashtagSolis: '88888888-8888-4888-8888-000000033002',
  handleTrattoria: '88888888-8888-4888-8888-000000033003',
  paused: '88888888-8888-4888-8888-000000033004',
} as const;

interface MentionSeed {
  id: string;
  termId: string;
  platform: string;
  authorHandle: string;
  authorDisplayName: string;
  body: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  sentimentScore: number;
  isLead: boolean;
  daysAgo: number;
  status: 'new' | 'triaged' | 'archived';
}

function buildMentions(): MentionSeed[] {
  const out: MentionSeed[] = [];
  const positiveTpl = [
    'Fui ayer y la pasé increíble en {term}, recomendadísimo.',
    'No puedo creer lo rica que está la comida en {term}, vuelvo seguro.',
    'El servicio en {term} es 10 de 10, qué buen trato.',
  ];
  const neutralTpl = [
    'Alguien sabe el horario de {term}?',
    'Qué tal {term}? Estoy pensando ir el sábado.',
    'Tienen opciones vegetarianas en {term}?',
  ];
  const negativeTpl = [
    'Decepcionado con {term}, esperaba mucho más por el precio.',
    'Tardaron una hora en atenderme en {term}, mal servicio.',
    'No volvería a {term}, hubo problemas con la reserva.',
  ];
  const leadTpl = [
    'Buscando una franquicia tipo {term}, alguien sabe si abren franquicias?',
    'Necesito hacer un evento para 30 personas, sirve {term} para eso?',
    'Cuánto cuesta una mesa para 8 en {term}? Es para un cumpleaños.',
  ];
  const authors = [
    ['cristina_m', 'Cristina Méndez'],
    ['jorge_lr', 'Jorge L. Ramírez'],
    ['ana_ofc', 'Ana Ortiz'],
    ['pedro_alfaro', 'Pedro Alfaro'],
    ['mariana_lopez', 'Mariana López'],
    ['carlos_re', 'Carlos Reyes'],
    ['mario_jr', 'Mario Jr.'],
    ['gabriela_s', 'Gabriela Salinas'],
  ] as const;
  const TERMS: ReadonlyArray<{ id: string; word: string; platforms: string[] }> = [
    {
      id: TERM_IDS.trattoria,
      word: 'La Trattoria',
      platforms: ['x', 'instagram'],
    },
    {
      id: TERM_IDS.hashtagSolis,
      word: '#consultaSolis',
      platforms: ['x', 'facebook'],
    },
    {
      id: TERM_IDS.handleTrattoria,
      word: '@latrattoria_mx',
      platforms: ['x', 'instagram', 'tiktok'],
    },
  ];

  let i = 0;
  for (const term of TERMS) {
    // ~27 mentions per active term → 81 total. Adjusts to 80 at the end.
    for (let n = 0; n < 27; n += 1) {
      const r = (n * 7 + i * 11) % 100;
      let sentiment: 'positive' | 'neutral' | 'negative';
      let tpl: string;
      let score: number;
      if (r < 40) {
        sentiment = 'positive';
        tpl = positiveTpl[n % positiveTpl.length]!;
        score = 0.8 + ((n * 13) % 20) / 100;
      } else if (r < 75) {
        sentiment = 'neutral';
        tpl = neutralTpl[n % neutralTpl.length]!;
        score = 0.5;
      } else {
        sentiment = 'negative';
        tpl = negativeTpl[n % negativeTpl.length]!;
        score = 0.75 + ((n * 17) % 20) / 100;
      }
      // ~ 15% leads — for every 7th mention pick a lead template
      // regardless of sentiment bucket.
      const isLead = i % 7 === 0;
      if (isLead) {
        tpl = leadTpl[i % leadTpl.length]!;
        sentiment = 'neutral';
        score = 0.7;
      }
      const author = authors[i % authors.length]!;
      const platform = term.platforms[n % term.platforms.length]!;
      const daysAgo = ((i * 3) % 28) + 1;
      const status: 'new' | 'triaged' | 'archived' =
        i % 13 === 0 ? 'archived' : i % 11 === 0 ? 'triaged' : 'new';
      out.push({
        id: `77777777-7777-4777-8777-${String(i + 1).padStart(12, '0')}`,
        termId: term.id,
        platform,
        authorHandle: author[0],
        authorDisplayName: author[1],
        body: tpl.replace('{term}', term.word),
        sentiment,
        sentimentScore: Math.round(score * 100) / 100,
        isLead,
        daysAgo,
        status,
      });
      i += 1;
    }
  }
  // Truncate to 80 (the prompt's target).
  return out.slice(0, 80);
}

export async function seedListening(tx: AnyPgTx): Promise<void> {
  const now = new Date();

  // 1. Tracked terms — 4 per org.
  await tx
    .insert(listeningTrackedTerms)
    .values([
      {
        id: TERM_IDS.trattoria,
        organizationId: ORG,
        brandId: SEED_IDS.brand.trattoria,
        term: 'La Trattoria',
        termKind: 'keyword',
        platforms: ['x', 'instagram'],
        status: 'active',
      },
      {
        id: TERM_IDS.hashtagSolis,
        organizationId: ORG,
        brandId: SEED_IDS.brand.clinica,
        term: '#consultaSolis',
        termKind: 'hashtag',
        platforms: ['x', 'facebook'],
        status: 'active',
      },
      {
        id: TERM_IDS.handleTrattoria,
        organizationId: ORG,
        brandId: SEED_IDS.brand.trattoria,
        term: '@latrattoria_mx',
        termKind: 'handle',
        platforms: ['x', 'instagram', 'tiktok'],
        status: 'active',
      },
      {
        id: TERM_IDS.paused,
        organizationId: ORG,
        brandId: SEED_IDS.brand.clinica,
        term: 'clinica solis',
        termKind: 'keyword',
        platforms: ['x', 'reddit'],
        status: 'paused',
      },
    ])
    .onConflictDoNothing({ target: listeningTrackedTerms.id });

  // 2. Mentions — pre-classified per R-33-1.
  const mentions = buildMentions();
  await tx
    .insert(listeningMentions)
    .values(
      mentions.map((m) => ({
        id: m.id,
        organizationId: ORG,
        trackedTermId: m.termId,
        brandId:
          m.termId === TERM_IDS.hashtagSolis
            ? SEED_IDS.brand.clinica
            : SEED_IDS.brand.trattoria,
        platform: m.platform,
        externalId: `seed-${m.id}`,
        authorHandle: m.authorHandle,
        authorDisplayName: m.authorDisplayName,
        body: m.body,
        url: `https://mock.${m.platform}.example.com/posts/${m.id}`,
        kind: 'post' as const,
        sentiment: m.sentiment,
        sentimentScore: m.sentimentScore.toFixed(2),
        isLead: m.isLead,
        status: m.status,
        capturedAt: new Date(now.getTime() - m.daysAgo * 86_400_000),
      })),
    )
    .onConflictDoNothing({ target: listeningMentions.id });
}

// Touch sql so the import stays live for future expansion.
void sql;
