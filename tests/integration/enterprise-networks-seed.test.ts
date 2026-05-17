import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  brands,
  locations,
  organizations,
  plans,
  reviews,
  users,
} from '../../lib/db/schema';
import { SEED_IDS } from '../../lib/db/seed';
import { seedEnterpriseNetworks } from '../../lib/db/seed-enterprise-networks';
import { listReviewsWithTx } from '../../lib/reviews/queries';
import {
  BbbPlatformSpecificSchema,
  YelpPlatformSpecificSchema,
} from '../../lib/reviews/platform-specific-schemas';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 10 / Commit 38 — seed roundtrip + render-only Zod safety.
 *
 * Verifies that running `seedEnterpriseNetworks` against a fresh test
 * DB produces rows whose `platform_specific` column round-trips
 * through the listing projection and validates against the strict
 * per-platform Zod schemas.
 */

let fixture: TestDb;
const planId = '00000000-0000-4000-8000-fff000038001';
const orgId = SEED_IDS.org.demo;
const userId = '22222222-2222-4222-8222-fff000038001';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({
      id: userId,
      email: 'seed-test@blacknel.test',
      name: 'Seed Tester',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Demo Org',
      slug: 'demo-org',
      planId,
    });

    // Seed dependencies: the demo location IDs that
    // seed-enterprise-networks.ts targets.
    await tx.insert(brands).values([
      {
        id: SEED_IDS.brand.trattoria,
        organizationId: orgId,
        name: 'Trattoria',
        slug: 'trattoria',
      },
      {
        id: SEED_IDS.brand.clinica,
        organizationId: orgId,
        name: 'Clinica',
        slug: 'clinica',
      },
    ]);
    await tx.insert(locations).values([
      {
        id: SEED_IDS.location.trattoriaDowntown,
        organizationId: orgId,
        brandId: SEED_IDS.brand.trattoria,
        name: 'Trattoria Downtown',
      },
      {
        id: SEED_IDS.location.trattoriaMall,
        organizationId: orgId,
        brandId: SEED_IDS.brand.trattoria,
        name: 'Trattoria Mall',
      },
      {
        id: SEED_IDS.location.clinicaCentral,
        organizationId: orgId,
        brandId: SEED_IDS.brand.clinica,
        name: 'Clinica Central',
      },
      {
        id: SEED_IDS.location.clinicaWest,
        organizationId: orgId,
        brandId: SEED_IDS.brand.clinica,
        name: 'Clinica West',
      },
    ]);

    await seedEnterpriseNetworks(tx);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('seedEnterpriseNetworks', () => {
  it('inserts rows for all 5 enterprise platforms', async () => {
    const rows = await runAdmin<Array<{ platform: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ platform: reviews.platform })
          .from(reviews)
          .where(eq(reviews.organizationId, orgId)),
    );
    const platforms = new Set(rows.map((r) => r.platform));
    expect(platforms.has('yelp')).toBe(true);
    expect(platforms.has('tripadvisor')).toBe(true);
    expect(platforms.has('trustpilot')).toBe(true);
    expect(platforms.has('bbb')).toBe(true);
    expect(platforms.has('avvo')).toBe(true);
  });

  it('is idempotent — second run is a no-op on the unique index', async () => {
    const beforeRows = await runAdmin<Array<{ id: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ id: reviews.id })
          .from(reviews)
          .where(eq(reviews.organizationId, orgId)),
    );
    const beforeCount = beforeRows.length;

    await runAdmin(fixture.db, async (tx) => seedEnterpriseNetworks(tx));

    const afterRows = await runAdmin<Array<{ id: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ id: reviews.id })
          .from(reviews)
          .where(eq(reviews.organizationId, orgId)),
    );
    expect(afterRows.length).toBe(beforeCount);
  });

  it('BBB rows use rating sentinel = 1 (force-fit, TODO bbb-complaint-model-revisit-phase-11)', async () => {
    const bbbRows = await runAdmin<
      Array<{ rating: number; platformSpecific: unknown }>
    >(fixture.db, async (tx) =>
      tx
        .select({
          rating: reviews.rating,
          platformSpecific: reviews.platformSpecific,
        })
        .from(reviews)
        .where(eq(reviews.platform, 'bbb')),
    );
    expect(bbbRows.length).toBeGreaterThan(0);
    for (const r of bbbRows) {
      expect(r.rating).toBe(1);
      expect(() => BbbPlatformSpecificSchema.parse(r.platformSpecific)).not.toThrow();
    }
  });

  it('Yelp rows carry valid platform_specific shape', async () => {
    const yelpRows = await runAdmin<Array<{ platformSpecific: unknown }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ platformSpecific: reviews.platformSpecific })
          .from(reviews)
          .where(eq(reviews.platform, 'yelp')),
    );
    for (const r of yelpRows) {
      if (r.platformSpecific === null) continue;
      expect(() => YelpPlatformSpecificSchema.parse(r.platformSpecific)).not.toThrow();
    }
  });
});

describe('listReviewsWithTx — platformSpecific surfacing', () => {
  it('projects platform_specific through to ReviewListItem', async () => {
    const page = await runAs(
      fixture.db,
      { orgId, userId },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId,
          userId,
          filters: { platform: ['trustpilot'] },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.reviews.length).toBeGreaterThan(0);
    for (const r of page.reviews) {
      expect(r.platform).toBe('trustpilot');
      // Render-only payload must be present (or null) but well-typed.
      if (r.platformSpecific !== null) {
        expect(typeof r.platformSpecific).toBe('object');
      }
    }
  });

  it('BBB rows surface complaint_status in platformSpecific (UI consumes via BBBComplaintCard)', async () => {
    const page = await runAs(
      fixture.db,
      { orgId, userId },
      async (tx) =>
        listReviewsWithTx(tx, {
          orgId,
          userId,
          filters: { platform: ['bbb'] },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.reviews.length).toBeGreaterThan(0);
    for (const r of page.reviews) {
      const ps = r.platformSpecific;
      expect(ps).not.toBeNull();
      const status = ps?.['complaint_status'];
      expect(['pending', 'assigned', 'resolved', 'closed']).toContain(status);
    }
  });
});

describe('render-only rule — platform_specific has no index', () => {
  // The migration deliberately ships ZERO index on platform_specific.
  // If a future migration adds one, this test fires as the canary —
  // the C38 commit message and TODO anchor make the rationale
  // explicit. ALTER + add index requires promoting the field to a
  // typed column first.
  it('reviews table has no index whose name references platform_specific', async () => {
    const indexes = await runAdmin(fixture.db, async (tx) => {
      const result = await tx.execute(
        sql.raw(`SELECT indexname FROM pg_indexes WHERE tablename = 'reviews'`),
      );
      const rows =
        'rows' in result && Array.isArray((result as { rows: unknown[] }).rows)
          ? (result as { rows: Array<{ indexname: string }> }).rows
          : (result as unknown as Array<{ indexname: string }>);
      return rows;
    });
    for (const idx of indexes) {
      expect(idx.indexname).not.toContain('platform_specific');
    }
  });
});

describe('connector registry — Enterprise capabilities (Ajuste D-38-5)', () => {
  it('Yelp capabilities include review_dispute but NOT reply_reviews', async () => {
    const { YELP_CAPABILITIES } = await import(
      '../../lib/connectors/yelp/capabilities'
    );
    expect(YELP_CAPABILITIES.supported).toContain('read_reviews');
    expect(YELP_CAPABILITIES.supported).toContain('review_dispute');
    expect(YELP_CAPABILITIES.supported).not.toContain('reply_reviews');
  });

  it('BBB capabilities expose complaint_response', async () => {
    const { BBB_CAPABILITIES } = await import(
      '../../lib/connectors/bbb/capabilities'
    );
    expect(BBB_CAPABILITIES.supported).toContain('complaint_response');
  });

  it('Trustpilot capabilities expose send_review_request', async () => {
    const { TRUSTPILOT_CAPABILITIES } = await import(
      '../../lib/connectors/trustpilot/capabilities'
    );
    expect(TRUSTPILOT_CAPABILITIES.supported).toContain(
      'send_review_request',
    );
  });
});

describe('Enterprise plan gating', () => {
  it('all 5 enterprise platforms are in PLANS.enterprise.features.networks', async () => {
    const { PLANS } = await import('../../lib/plans/plans');
    const networks = PLANS.enterprise.features.networks;
    expect(networks).toContain('yelp');
    expect(networks).toContain('tripadvisor');
    expect(networks).toContain('trustpilot');
    expect(networks).toContain('bbb');
    expect(networks).toContain('avvo');
  });

  it('none of the 5 enterprise platforms appear in PLANS.growth.features.networks', async () => {
    const { PLANS } = await import('../../lib/plans/plans');
    const networks = PLANS.growth.features.networks;
    for (const p of ['yelp', 'tripadvisor', 'trustpilot', 'bbb', 'avvo']) {
      expect(networks).not.toContain(p);
    }
  });

  it('intersection of enterprise platforms with Growth plan is empty (defense-in-depth)', async () => {
    const { planAllowsPlatform } = await import('../../lib/plans/gating');
    const enterprisePlatforms = [
      'yelp',
      'tripadvisor',
      'trustpilot',
      'bbb',
      'avvo',
    ] as const;
    for (const p of enterprisePlatforms) {
      expect(planAllowsPlatform('growth', p)).toBe(false);
      expect(planAllowsPlatform('enterprise', p)).toBe(true);
    }
  });

});
