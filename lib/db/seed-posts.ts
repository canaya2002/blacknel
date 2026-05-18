import 'server-only';

import { and, eq } from 'drizzle-orm';

import { connectedAccounts, postTargets, posts } from './schema';
import { SEED_CAMPAIGN_IDS } from './seed-campaigns';
import { SEED_IDS } from './seed';

import type { AnyPgTx } from './client';

/**
 * Phase-6 / Commit-17 posts seed. 40 posts across the status mix
 * the user spec'd:
 *
 *   - 8 drafts                    (no scheduled_at, status=draft)
 *   - 12 scheduled (next 7 days)
 *   - 15 published (last 30 days) (published_at set, status=published)
 *   - 3 failed                     (status=failed, target rows show why)
 *   - 2 pending_approval
 *
 * `post_targets` are created against whatever
 * `connected_accounts` rows already exist in the org. If the
 * `BLACKNEL_SEED_CONNECTED` flag was set to `false` (integration
 * tests opt-out), the posts seed still inserts posts but skips
 * the target rows — the parent list view still works, just with
 * `targetCount=0`.
 *
 * Deterministic via a tiny LCG. Idempotent via
 * `ON CONFLICT DO NOTHING` on the deterministic id.
 */

const ORG = SEED_IDS.org.demo;
const NOW = new Date('2026-05-15T16:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const POST_BODIES_TRATTORIA = [
  '¡Pasta carbonara recién salida del horno! 🍝 Pasen a probarla.',
  'Nuevo postre en el menú: tiramisú con espresso doble.',
  'Reservaciones abiertas para el fin de semana — cupos limitados.',
  'Detrás de cámaras: el chef preparando salsa marinara fresca.',
  '¿Pizza o pasta? La pregunta eterna. Voten en comentarios.',
  'Promo del día: 2x1 en bebidas con compra de plato principal.',
  'Estamos contratando: meseros con experiencia. DM para info.',
  'Cerramos temprano este jueves por evento privado. Disculpen.',
  '¡Gracias por las reseñas! 4.6 estrellas y subiendo.',
  'Nuestro horario navideño cambia: revisen el sitio web.',
];

const POST_BODIES_CLINICA = [
  'Campaña de vacunación gratuita este sábado. Agenda tu cita.',
  'Recordatorio: chequeos anuales pueden prevenir problemas mayores.',
  'Nueva especialidad: nutrición clínica. Conoce al equipo.',
  'Tips de salud: 5 hábitos que mejoran tu sueño esta semana.',
  '¿Síntomas raros? Mejor revisar antes que esperar. Llámanos.',
  'Promo: primera consulta nutrición con 30% de descuento.',
  'Día Mundial del Corazón — agenda tu chequeo cardiovascular.',
  'Nuestras instalaciones cumplen con todos los protocolos sanitarios.',
];

interface PostSpec {
  id: string;
  brandId: string;
  campaignId: string | null;
  text: string;
  status: 'draft' | 'pending_approval' | 'scheduled' | 'published' | 'failed';
  scheduledAt: Date | null;
  publishedAt: Date | null;
  authorId: string;
}

function postId(i: number): string {
  return `99999999-9999-4999-8999-aa00000000${String(i).padStart(2, '0')}`;
}

function targetId(postIdx: number, accountIdx: number): string {
  return `99999999-9999-4999-8999-bb00${String(postIdx).padStart(4, '0')}${String(accountIdx).padStart(4, '0')}`;
}

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

function buildSpecs(): PostSpec[] {
  const rnd = lcg(7919);
  const specs: PostSpec[] = [];

  // 8 drafts
  for (let i = 0; i < 8; i++) {
    const trattoria = rnd() < 0.6;
    specs.push({
      id: postId(specs.length),
      brandId: trattoria ? SEED_IDS.brand.trattoria : SEED_IDS.brand.clinica,
      campaignId: trattoria ? SEED_CAMPAIGN_IDS.evergreen : SEED_CAMPAIGN_IDS.awareness,
      text: pick(rnd, trattoria ? POST_BODIES_TRATTORIA : POST_BODIES_CLINICA),
      status: 'draft',
      scheduledAt: null,
      publishedAt: null,
      authorId: pick(rnd, [SEED_IDS.user.manager, SEED_IDS.user.admin1, SEED_IDS.user.agent]),
    });
  }

  // 12 scheduled (next 7 days)
  for (let i = 0; i < 12; i++) {
    const trattoria = rnd() < 0.6;
    const offsetHours = Math.floor(rnd() * 7 * 24);
    specs.push({
      id: postId(specs.length),
      brandId: trattoria ? SEED_IDS.brand.trattoria : SEED_IDS.brand.clinica,
      campaignId: trattoria ? SEED_CAMPAIGN_IDS.promotion : SEED_CAMPAIGN_IDS.awareness,
      text: pick(rnd, trattoria ? POST_BODIES_TRATTORIA : POST_BODIES_CLINICA),
      status: 'scheduled',
      scheduledAt: new Date(NOW + offsetHours * HOUR),
      publishedAt: null,
      authorId: pick(rnd, [SEED_IDS.user.manager, SEED_IDS.user.admin1]),
    });
  }

  // 15 published (last 30 days)
  for (let i = 0; i < 15; i++) {
    const trattoria = rnd() < 0.6;
    const offsetDays = Math.floor(rnd() * 30);
    const published = new Date(NOW - offsetDays * DAY - Math.floor(rnd() * HOUR));
    specs.push({
      id: postId(specs.length),
      brandId: trattoria ? SEED_IDS.brand.trattoria : SEED_IDS.brand.clinica,
      campaignId: trattoria ? SEED_CAMPAIGN_IDS.evergreen : SEED_CAMPAIGN_IDS.awareness,
      text: pick(rnd, trattoria ? POST_BODIES_TRATTORIA : POST_BODIES_CLINICA),
      status: 'published',
      scheduledAt: new Date(published.getTime() - 30 * 60 * 1000),
      publishedAt: published,
      authorId: pick(rnd, [SEED_IDS.user.manager, SEED_IDS.user.admin1, SEED_IDS.user.agent]),
    });
  }

  // 3 failed (last 5 days)
  for (let i = 0; i < 3; i++) {
    const offsetHours = Math.floor(rnd() * 5 * 24);
    specs.push({
      id: postId(specs.length),
      brandId: SEED_IDS.brand.trattoria,
      campaignId: SEED_CAMPAIGN_IDS.promotion,
      text: pick(rnd, POST_BODIES_TRATTORIA),
      status: 'failed',
      scheduledAt: new Date(NOW - offsetHours * HOUR),
      publishedAt: null,
      authorId: SEED_IDS.user.agent,
    });
  }

  // 2 pending_approval
  for (let i = 0; i < 2; i++) {
    specs.push({
      id: postId(specs.length),
      brandId: SEED_IDS.brand.clinica,
      campaignId: SEED_CAMPAIGN_IDS.awareness,
      text: pick(rnd, POST_BODIES_CLINICA),
      status: 'pending_approval',
      scheduledAt: new Date(NOW + (24 + i * 12) * HOUR),
      publishedAt: null,
      authorId: SEED_IDS.user.agent,
    });
  }

  return specs;
}

const FAILED_ERROR_MESSAGES = [
  'POST_RATE_LIMIT_EXCEEDED: facebook returned 429 after 3 attempts.',
  'MEDIA_INVALID_FORMAT: instagram rejected attached image (size > 8MB).',
  'CONTENT_POLICY_VIOLATION: linkedin flagged copy as promotional spam.',
];

export async function seedPosts(tx: AnyPgTx): Promise<void> {
  const specs = buildSpecs();

  await tx
    .insert(posts)
    .values(
      specs.map((s) => ({
        id: s.id,
        organizationId: ORG,
        brandId: s.brandId,
        campaignId: s.campaignId,
        authorId: s.authorId,
        status: s.status,
        text: s.text,
        scheduledAt: s.scheduledAt,
        publishedAt: s.publishedAt,
      })),
    )
    .onConflictDoNothing({ target: posts.id });

  // Look up the org's connected accounts. If the operator opted
  // out of BLACKNEL_SEED_CONNECTED, this returns empty and we
  // skip target rows entirely — the parent list view still works.
  // ORDER BY is load-bearing: without it, pglite / Postgres can return
  // accountRows in different orders between seed runs. The rnd-driven
  // index picks below then map to different accounts each run, and the
  // (post_id, connected_account_id) pairs we generate stop being stable.
  // That collides with `post_targets_post_account_active_unique` (partial
  // unique, WHERE status <> 'failed') on the second seed run because the
  // ON CONFLICT below only covers the PK. See commit message + history
  // for the full diagnosis.
  const accountRows = await tx
    .select({ id: connectedAccounts.id, platform: connectedAccounts.platform })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.organizationId, ORG))
    .orderBy(connectedAccounts.id);

  if (accountRows.length === 0) return;

  // Distribute targets: 1-3 accounts per post, randomly chosen.
  const targetRows: Array<typeof postTargets.$inferInsert> = [];
  const rnd = lcg(31337);
  specs.forEach((s, postIdx) => {
    const count = 1 + Math.floor(rnd() * Math.min(3, accountRows.length));
    const picked = new Set<number>();
    while (picked.size < count) {
      picked.add(Math.floor(rnd() * accountRows.length));
    }
    const accounts = [...picked].map((i) => accountRows[i]!);
    accounts.forEach((account, accountIdx) => {
      // Seed never emits 'publishing' parent posts (that's a
      // transient state only the publish-job writes). Map the
      // remaining parent statuses to the corresponding target.
      const targetStatus: typeof postTargets.$inferInsert.status =
        s.status === 'published'
          ? 'published'
          : s.status === 'failed'
            ? 'failed'
            : 'pending';
      targetRows.push({
        id: targetId(postIdx, accountIdx),
        organizationId: ORG,
        postId: s.id,
        connectedAccountId: account.id,
        status: targetStatus,
        externalPostId:
          targetStatus === 'published' ? `mock-post-${account.platform}-${postIdx}-${accountIdx}` : null,
        publishedAt: s.publishedAt,
        errorMessage:
          targetStatus === 'failed' ? pick(rnd, FAILED_ERROR_MESSAGES) : null,
        attemptCount: targetStatus === 'failed' ? 3 : targetStatus === 'published' ? 1 : 0,
      });
    });
  });

  if (targetRows.length > 0) {
    // No `target:` — Postgres `ON CONFLICT DO NOTHING` without a conflict
    // target swallows ANY unique / exclusion constraint violation. Defense
    // in depth against the partial unique index
    // `post_targets_post_account_active_unique` if the ORDER BY above ever
    // stops being enough (e.g. another seed adds connected_accounts mid-
    // run). FK / NOT NULL violations are NOT silenced — those still error.
    await tx.insert(postTargets).values(targetRows).onConflictDoNothing();
  }

  // Silence unused-imports lint if a future refactor moves the
  // and/eq imports off this module.
  void and;
}
