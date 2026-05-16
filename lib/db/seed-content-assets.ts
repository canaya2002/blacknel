import 'server-only';

import { contentAssets } from './schema';
import { SEED_IDS } from './seed';

import type { AnyPgTx } from './client';

/**
 * Phase-6 / Commit-17 asset-library seed. 20 mock assets split
 * across the two demo brands (12 Trattoria food / dishes / behind-
 * the-scenes; 8 Clínica Solis facility / team / wellness).
 *
 * Kinds distribution: 14 image / 4 video / 2 pdf (no gifs in the
 * seed — TikTok and X are the heavy gif users and we'd only have
 * 1-2 representative samples). The composer (Commit 19) reads from
 * here; the publish-job (Commit 20) increments `used_count`.
 *
 * `url` points at placeholder paths under `.blacknel/uploads/` —
 * the dev server doesn't serve them as static files yet; Commit 19
 * wires up an `/api/uploads/[...path]` route handler.
 *
 * Deterministic — `ON CONFLICT DO NOTHING` on the id keeps the
 * seed idempotent on re-runs.
 */

const ORG = SEED_IDS.org.demo;
const NOW = new Date('2026-05-15T16:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

const TRATTORIA_ASSETS = [
  { id: '01', kind: 'image' as const, name: 'Pasta carbonara — close-up', tags: ['comida', 'pasta'] },
  { id: '02', kind: 'image' as const, name: 'Pizza margherita — horno', tags: ['comida', 'pizza'] },
  { id: '03', kind: 'image' as const, name: 'Lasagna — porción servida', tags: ['comida', 'lasagna'] },
  { id: '04', kind: 'image' as const, name: 'Tiramisú — toma cenital', tags: ['postre'] },
  { id: '05', kind: 'image' as const, name: 'Chef preparando salsa', tags: ['behind-the-scenes', 'chef'] },
  { id: '06', kind: 'image' as const, name: 'Mesa con vino — cena para 2', tags: ['ambiente', 'cena'] },
  { id: '07', kind: 'image' as const, name: 'Terraza — atardecer', tags: ['ambiente', 'terraza'] },
  { id: '08', kind: 'video' as const, name: 'Reel — tour del restaurante', tags: ['reel', 'tour'] },
  { id: '09', kind: 'video' as const, name: 'Reel — pasta fresca a mano', tags: ['reel', 'pasta'] },
  { id: '0a', kind: 'image' as const, name: 'Equipo — staff completo', tags: ['equipo'] },
  { id: '0b', kind: 'image' as const, name: 'Menú del día — pizarra', tags: ['menú'] },
  { id: '0c', kind: 'pdf' as const, name: 'Menú completo — descargable', tags: ['menú', 'pdf'] },
] as const;

const CLINICA_ASSETS = [
  { id: '11', kind: 'image' as const, name: 'Recepción — Clínica Solis Centro', tags: ['instalaciones'] },
  { id: '12', kind: 'image' as const, name: 'Sala de espera — pediatría', tags: ['instalaciones', 'pediatría'] },
  { id: '13', kind: 'image' as const, name: 'Equipo médico — sonriendo', tags: ['equipo', 'médico'] },
  { id: '14', kind: 'image' as const, name: 'Doctora atendiendo paciente', tags: ['atención'] },
  { id: '15', kind: 'video' as const, name: 'Video — testimonio paciente', tags: ['testimonio', 'video'] },
  { id: '16', kind: 'video' as const, name: 'Video — recorrido instalaciones', tags: ['instalaciones', 'tour'] },
  { id: '17', kind: 'image' as const, name: 'Equipo — campaña vacunación', tags: ['campaña', 'salud'] },
  { id: '18', kind: 'pdf' as const, name: 'Brochure — servicios médicos', tags: ['brochure', 'pdf'] },
] as const;

function assetId(suffix: string): string {
  return `dddddddd-dddd-4ddd-8ddd-aa00000000${suffix}`;
}

export async function seedContentAssets(tx: AnyPgTx): Promise<void> {
  const rows: Array<typeof contentAssets.$inferInsert> = [];

  TRATTORIA_ASSETS.forEach((a, i) => {
    rows.push({
      id: assetId(a.id),
      organizationId: ORG,
      brandId: SEED_IDS.brand.trattoria,
      kind: a.kind,
      url: `/.blacknel/uploads/trattoria/${a.id}.${a.kind === 'video' ? 'mp4' : a.kind === 'pdf' ? 'pdf' : 'jpg'}`,
      thumbnailUrl:
        a.kind === 'video' || a.kind === 'image'
          ? `/.blacknel/uploads/trattoria/${a.id}-thumb.jpg`
          : null,
      name: a.name,
      tags: [...a.tags],
      uploadedBy: SEED_IDS.user.manager,
      // Spread usedCount across the seed so the "most-used" sort has
      // something to do. 0..15 range, decreasing slightly with index
      // so older assets read as "less recently used".
      usedCount: Math.max(0, 15 - i),
      createdAt: new Date(NOW - (180 - i * 5) * DAY),
    });
  });

  CLINICA_ASSETS.forEach((a, i) => {
    rows.push({
      id: assetId(a.id),
      organizationId: ORG,
      brandId: SEED_IDS.brand.clinica,
      kind: a.kind,
      url: `/.blacknel/uploads/clinica/${a.id}.${a.kind === 'video' ? 'mp4' : a.kind === 'pdf' ? 'pdf' : 'jpg'}`,
      thumbnailUrl:
        a.kind === 'video' || a.kind === 'image'
          ? `/.blacknel/uploads/clinica/${a.id}-thumb.jpg`
          : null,
      name: a.name,
      tags: [...a.tags],
      uploadedBy: SEED_IDS.user.admin2,
      usedCount: Math.max(0, 10 - i),
      createdAt: new Date(NOW - (120 - i * 5) * DAY),
    });
  });

  await tx
    .insert(contentAssets)
    .values(rows)
    .onConflictDoNothing({ target: contentAssets.id });
}
