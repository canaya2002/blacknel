import 'server-only';

import { createHash } from 'node:crypto';

import { reviews } from './schema';
import { SEED_IDS } from './seed';

import {
  generateReviewsForDay,
  type MockReview,
} from '../connectors/base/review-generator';
import { validatePlatformSpecific } from '../reviews/platform-specific-schemas';

import type { AnyPgTx } from './client';

/**
 * Stable deterministic uuid v4-ish from a string seed. Used so this
 * seed's primary key conflict resolution (`ON CONFLICT id`) lands on
 * the same row across re-runs.
 *
 * The partial unique index `(org, platform, external_review_id) WHERE
 * external_review_id IS NOT NULL` exists in 0006 — but ON CONFLICT on
 * a partial index requires pglite/Postgres to match the predicate
 * exactly. Routing through the primary key dodges that requirement
 * with the same idempotency guarantee.
 */
function uuidFromSeed(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  // RFC 4122 v4 layout: 8-4-4-4-12 with the version (4) + variant (8/9/a/b) bits forced.
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    '8' + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

/**
 * Phase 10 / Commit 38 — Enterprise Networks demo seed.
 *
 * Seeds 5 Enterprise-tier platforms (yelp, tripadvisor, trustpilot,
 * bbb, avvo) using the deterministic
 * `lib/connectors/base/review-generator.ts`. Each platform runs across
 * 7 recent days on a single representative location, producing a
 * realistic spread without dwarfing the Phase-5 base seed (80 rows on
 * the Growth networks).
 *
 * # Why seed Enterprise-only platforms on a Growth org?
 *
 * Mirrors the Phase-5 yelp seed precedent: the demo org runs on
 * Growth, the Enterprise networks plan gate at `/reviews` shows the
 * upgrade banner, but the rows EXIST in DB so the gating itself can
 * be tested end-to-end. When the demo org is bumped to Enterprise
 * for a screenshare, these rows surface immediately.
 *
 * # BBB rating sentinel (force-fit, see TODO bbb-complaint-model-revisit-phase-11)
 *
 * `reviews.rating` is `NOT NULL` with `CHECK (rating BETWEEN 1 AND 5)`
 * since Phase 5 (`0006_reviews.sql`). BBB complaints don't carry a
 * star rating — the generator returns `rating: null` for BBB rows.
 * Here we **force-fit** the sentinel `rating = 1` on BBB inserts and
 * the UI hides the stars block when `platform === 'bbb'`, rendering
 * `BBBComplaintCard` instead. The proper fix (nullable rating or
 * separate `complaints` table) lands in Phase 11.
 *
 * Idempotent via `ON CONFLICT DO NOTHING` on the unique partial index
 * `(organization_id, platform, external_review_id)`.
 */

const ORG = SEED_IDS.org.demo;

// Locations distributed by vertical (Ajuste D-38-4):
//   hospitality (yelp / tripadvisor) → Trattoria Downtown
//   e-commerce  (trustpilot)         → Trattoria Mall (proxy for online shop)
//   bbb (general business)           → Clinica Central
//   avvo (legal)                     → Clinica West
const LOCATION_BY_PLATFORM: Record<string, string> = {
  yelp: SEED_IDS.location.trattoriaDowntown,
  tripadvisor: SEED_IDS.location.trattoriaDowntown,
  trustpilot: SEED_IDS.location.trattoriaMall,
  bbb: SEED_IDS.location.clinicaCentral,
  avvo: SEED_IDS.location.clinicaWest,
};

const BRAND_BY_PLATFORM: Record<string, string> = {
  yelp: SEED_IDS.brand.trattoria,
  tripadvisor: SEED_IDS.brand.trattoria,
  trustpilot: SEED_IDS.brand.trattoria,
  bbb: SEED_IDS.brand.clinica,
  avvo: SEED_IDS.brand.clinica,
};

const PLATFORMS = ['yelp', 'tripadvisor', 'trustpilot', 'bbb', 'avvo'] as const;
type EnterprisePlatform = (typeof PLATFORMS)[number];

const DAYS_BACK = 7;
const REFERENCE_NOW = new Date('2026-05-15T16:00:00Z');

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function seedEnterpriseNetworks(tx: AnyPgTx): Promise<void> {
  const reviewRows: Array<typeof reviews.$inferInsert> = [];

  for (const platform of PLATFORMS) {
    for (let dayOffset = 0; dayOffset < DAYS_BACK; dayOffset += 1) {
      const day = new Date(
        REFERENCE_NOW.getTime() - dayOffset * 24 * 60 * 60 * 1000,
      );
      const accountId = `enterprise-${platform}-${ORG}`;
      const generated: ReadonlyArray<MockReview> = generateReviewsForDay({
        orgId: ORG,
        accountId,
        day: dayString(day),
        platform,
      });

      for (const mock of generated) {
        // Render-only payload — validated via the per-platform Zod
        // schema (defense in depth; the generator already shapes
        // this correctly).
        const platformSpecific = validatePlatformSpecific(
          platform,
          mock.platformSpecific,
        );

        // BBB rating sentinel — see file header.
        const rating =
          platform === 'bbb' ? 1 : (mock.rating ?? 3);

        const sentiment: 'positive' | 'neutral' | 'negative' | 'unknown' =
          platform === 'bbb' ? 'negative' : mock.sentiment;

        reviewRows.push({
          id: uuidFromSeed(`enterprise-networks|${ORG}|${platform}|${mock.externalId}`),
          organizationId: ORG,
          brandId: BRAND_BY_PLATFORM[platform]!,
          locationId: LOCATION_BY_PLATFORM[platform]!,
          platform,
          externalReviewId: mock.externalId,
          authorName: mock.authorName,
          authorAvatar: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(mock.authorName)}`,
          rating,
          body: mock.body,
          language: 'es',
          postedAt: mock.postedAt,
          sentiment,
          status: 'pending',
          escalated: false,
          tags: [],
          platformSpecific: platformSpecific as Record<string, unknown> | null,
        });
      }
    }
  }

  if (reviewRows.length === 0) return;

  await tx
    .insert(reviews)
    .values(reviewRows)
    .onConflictDoNothing({ target: reviews.id });
}

export const ENTERPRISE_NETWORK_PLATFORMS: ReadonlyArray<EnterprisePlatform> =
  PLATFORMS;
