import 'server-only';

import { sql } from 'drizzle-orm';

import { SEED_IDS } from './seed';
import {
  contactProfiles,
  inboxMessages,
  inboxThreads,
} from './schema';

import type { AnyPgTx } from './client';

/**
 * Phase-4 inbox dataset for the Blacknel Demo org. Idempotent via
 * deterministic UUIDs + ON CONFLICT DO NOTHING — re-running on every
 * boot rebuilds the same world.
 *
 * Targets per the master prompt:
 *
 *   - 150 threads across 5 platforms (Growth-plan set)
 *   - 15% negative sentiment, 20% urgent priority, 30% unassigned
 *   - 4–8 messages per thread (~700 messages total)
 *   - 80 unique contact profiles, some recurring across threads
 *
 * Determinism: a tiny LCG seeded with the thread index gives stable
 * field distributions across runs — no `Math.random`, no per-run
 * variance. The cost is a slightly more verbose generator, paid back by
 * tests that can rely on the exact dataset.
 */

const ORG = SEED_IDS.org.demo;
const ASSIGNABLE_USERS = [
  SEED_IDS.user.owner,
  SEED_IDS.user.admin1,
  SEED_IDS.user.admin2,
  SEED_IDS.user.manager,
  SEED_IDS.user.agent,
];

const BRANDS_LOCATIONS = [
  { brandId: SEED_IDS.brand.trattoria, locations: [
    SEED_IDS.location.trattoriaDowntown,
    SEED_IDS.location.trattoriaNorth,
    SEED_IDS.location.trattoriaMall,
  ] },
  { brandId: SEED_IDS.brand.clinica, locations: [
    SEED_IDS.location.clinicaCentral,
    SEED_IDS.location.clinicaWest,
  ] },
] as const;

const PLATFORMS = ['facebook', 'instagram', 'gbp', 'whatsapp', 'tiktok', 'linkedin'] as const;
type SeedPlatform = (typeof PLATFORMS)[number];

const KINDS_BY_PLATFORM: Record<SeedPlatform, ReadonlyArray<'dm' | 'comment' | 'mention' | 'review' | 'whatsapp'>> = {
  facebook: ['dm', 'comment', 'mention'],
  instagram: ['dm', 'comment'],
  gbp: ['review'],
  whatsapp: ['whatsapp'],
  tiktok: ['comment', 'mention'],
  linkedin: ['mention', 'comment'],
};

// Distribution buckets — index ranges into a `lcg() % 100` roll.
const STATUS_DIST: Array<[number, 'open' | 'pending' | 'closed' | 'snoozed' | 'spam']> = [
  [60, 'open'],
  [70, 'pending'],
  [85, 'closed'],
  [95, 'snoozed'],
  [100, 'spam'],
];
const PRIORITY_DIST: Array<[number, 'low' | 'normal' | 'high' | 'urgent']> = [
  [10, 'low'],
  [70, 'normal'],
  [80, 'high'],
  [100, 'urgent'],
];
const SENTIMENT_DIST: Array<[number, 'positive' | 'neutral' | 'negative' | 'unknown']> = [
  [30, 'positive'],
  [70, 'neutral'],
  [85, 'negative'],
  [100, 'unknown'],
];

const SUBJECT_LINES = [
  'Pregunta sobre el menú',
  'Reserva para esta noche',
  'Problema con la última visita',
  'Felicitaciones al equipo',
  'Disponibilidad de citas',
  'Cuenta dañada en la factura',
  'Cita reprogramada',
  'Demora en la entrega',
  'Solicitud de presupuesto',
  'Reseña en Google',
  '¿Tienen estacionamiento?',
  'Horario en festivos',
  '¿Aceptan reservas grupales?',
  'Mensaje desde anuncio de IG',
  'Cliente recurrente saludando',
  '',
];

const MESSAGE_BODIES = [
  'Hola, ¿podrían ayudarme con una pregunta?',
  'Quería agendar una cita para la próxima semana.',
  'Estoy muy decepcionado con la atención de hoy.',
  'Gracias por la excelente atención de hace dos días.',
  'Necesito reprogramar mi reserva.',
  '¿Cuál es su horario en festivos?',
  'Llevo media hora esperando respuesta.',
  '¿Tienen ofertas de fin de mes?',
  'El equipo fue muy amable.',
  'Estoy considerando dejarles una reseña — me trataron muy bien.',
  '¿Pueden enviarme el menú actualizado?',
  'Pedí un reembolso hace 5 días y nadie me ha contestado.',
  'Confirmo asistencia para mañana.',
  'Tengo una sugerencia sobre el servicio.',
  '¿Aceptan tarjeta de crédito?',
  '',
];

const CONTACT_NAMES = [
  'Ana López', 'Carlos Méndez', 'Sofía Ramírez', 'Diego Castro',
  'Lucía Fernández', 'Javier Soto', 'Camila Ortiz', 'Mateo Reyes',
  'Valentina Vargas', 'Sebastián Núñez', 'Renata Aguilar', 'Tomás Herrera',
  'Isabela Cruz', 'Andrés Salazar', 'Paula Domínguez', 'Felipe Acosta',
  'Daniela Mejía', 'Bruno Quintero', 'Antonia Cifuentes', 'Maximiliano Pino',
];

const CONTACT_TAGS_POOL = ['vip', 'recurrente', 'queja-abierta', 'lead-frio', 'lead-caliente', 'oposicion'];

const THREAD_TAGS_POOL = ['onboarding', 'soporte', 'ventas', 'urgente', 'spam-revisado', 'reembolso'];

function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function pick<T>(rnd: () => number, list: ReadonlyArray<T>): T {
  return list[Math.floor(rnd() * list.length)]!;
}

function pickByDist<T>(rnd: () => number, dist: Array<[number, T]>): T {
  const roll = Math.floor(rnd() * 100);
  for (const [bound, value] of dist) {
    if (roll < bound) return value;
  }
  return dist[dist.length - 1]![1];
}

function uuidThread(i: number): string {
  return `77777777-7777-4777-8777-${String(i).padStart(12, '0')}`;
}
function uuidMessage(i: number): string {
  return `88888888-8888-4888-8888-${String(i).padStart(12, '0')}`;
}
function uuidContact(i: number): string {
  return `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`;
}

interface SeededContact {
  id: string;
  platform: SeedPlatform;
  externalId: string;
  displayName: string;
  handle: string;
  avatarUrl: string;
  language: 'es' | 'en';
  tags: ReadonlyArray<string>;
}

function seedContacts(): ReadonlyArray<SeededContact> {
  const out: SeededContact[] = [];
  let i = 1;
  for (const platform of PLATFORMS) {
    for (let n = 0; n < 16; n++) {
      const name = CONTACT_NAMES[(i * 7) % CONTACT_NAMES.length]!;
      const handle = '@' + name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '');
      const rnd = lcg(i * 1000);
      const tagCount = Math.floor(rnd() * 3); // 0..2 tags
      const tags: string[] = [];
      for (let k = 0; k < tagCount; k++) {
        const t = pick(rnd, CONTACT_TAGS_POOL);
        if (!tags.includes(t)) tags.push(t);
      }
      out.push({
        id: uuidContact(i),
        platform,
        externalId: `${platform}-ext-${i}`,
        displayName: name,
        handle,
        avatarUrl: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`,
        language: i % 5 === 0 ? 'en' : 'es',
        tags,
      });
      i++;
    }
  }
  return out;
}

/**
 * Insert the contacts, threads and messages for the demo org.
 * Idempotent: every insert is `onConflictDoNothing` on the primary key.
 */
export async function seedInboxThreads(tx: AnyPgTx): Promise<void> {
  const contacts = seedContacts();

  await tx
    .insert(contactProfiles)
    .values(
      contacts.map((c) => ({
        id: c.id,
        organizationId: ORG,
        platform: c.platform,
        externalId: c.externalId,
        displayName: c.displayName,
        avatarUrl: c.avatarUrl,
        handle: c.handle,
        language: c.language,
        tags: c.tags,
      })),
    )
    .onConflictDoNothing({ target: contactProfiles.id });

  const TOTAL_THREADS = 150;
  const threadRows: Array<typeof inboxThreads.$inferInsert> = [];
  const messageRows: Array<{
    id: string;
    organizationId: string;
    threadId: string;
    direction: 'inbound' | 'outbound';
    authorType: 'contact' | 'user' | 'ai' | 'system';
    authorId: string | null;
    body: string;
    sentAt: Date;
  }> = [];

  let messageCounter = 1;
  const baseDate = new Date('2026-05-15T16:00:00Z').getTime();

  for (let i = 1; i <= TOTAL_THREADS; i++) {
    const rnd = lcg(i * 31 + 7);

    const platform = pick(rnd, PLATFORMS);
    const kind = pick(rnd, KINDS_BY_PLATFORM[platform]);
    const status = pickByDist(rnd, STATUS_DIST);
    const priority = pickByDist(rnd, PRIORITY_DIST);
    const sentiment = pickByDist(rnd, SENTIMENT_DIST);

    const isAssigned = rnd() > 0.3; // 70% assigned, 30% unassigned
    const assignedTo = isAssigned ? ASSIGNABLE_USERS[Math.floor(rnd() * ASSIGNABLE_USERS.length)]! : null;

    const brandIdx = rnd() < 0.6 ? 0 : 1; // 60% trattoria, 40% clinica
    const brandSlot = BRANDS_LOCATIONS[brandIdx]!;
    const locationId = brandSlot.locations[Math.floor(rnd() * brandSlot.locations.length)]!;

    const contact = contacts[(i * 13) % contacts.length]!;

    const tagsCount = Math.floor(rnd() * 3); // 0..2
    const tags: string[] = [];
    for (let k = 0; k < tagsCount; k++) {
      const t = pick(rnd, THREAD_TAGS_POOL);
      if (!tags.includes(t)) tags.push(t);
    }

    const subject = pick(rnd, SUBJECT_LINES) || null;

    // Threads age: 0–30 days back in 1-hour buckets.
    const ageMinutes = Math.floor(rnd() * 30 * 24 * 60);
    const lastMessageAt = new Date(baseDate - ageMinutes * 60 * 1000);

    const threadId = uuidThread(i);
    threadRows.push({
      id: threadId,
      organizationId: ORG,
      brandId: brandSlot.brandId,
      locationId,
      contactProfileId: contact.id,
      platform,
      externalThreadId: `${platform}-thr-${i}`,
      kind,
      status,
      priority,
      sentiment,
      assignedTo,
      subject,
      lastMessageAt,
      tags,
      closedAt: status === 'closed' || status === 'spam' ? lastMessageAt : null,
    });

    // 4–8 messages per thread, distributed before lastMessageAt.
    const msgCount = 4 + Math.floor(rnd() * 5);
    for (let m = msgCount; m >= 1; m--) {
      const direction: 'inbound' | 'outbound' = m % 2 === 1 ? 'inbound' : 'outbound';
      const authorType: 'contact' | 'user' = direction === 'inbound' ? 'contact' : 'user';
      const authorId =
        authorType === 'user'
          ? assignedTo ?? ASSIGNABLE_USERS[Math.floor(rnd() * ASSIGNABLE_USERS.length)]!
          : null;
      const body = pick(rnd, MESSAGE_BODIES) || 'Mensaje sin texto.';
      const sentAt = new Date(lastMessageAt.getTime() - (m - 1) * 12 * 60 * 1000);
      messageRows.push({
        id: uuidMessage(messageCounter++),
        organizationId: ORG,
        threadId,
        direction,
        authorType,
        authorId,
        body,
        sentAt,
      });
    }
  }

  // Batched inserts. ON CONFLICT DO NOTHING keeps the seed safe on
  // every dev boot, where the rows already exist after the first run.
  await tx.insert(inboxThreads).values(threadRows).onConflictDoNothing({ target: inboxThreads.id });
  // pglite caps a single INSERT at ~32k bind parameters; chunk to be safe.
  const CHUNK = 200;
  for (let off = 0; off < messageRows.length; off += CHUNK) {
    const slice = messageRows.slice(off, off + CHUNK);
    await tx.insert(inboxMessages).values(slice).onConflictDoNothing({ target: inboxMessages.id });
  }
  // Touch each thread's updated_at via the lastMessageAt write — already
  // set on insert. Nothing to do here.
  void sql; // keep the import live for future sql-template additions
}
