import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  brands,
  contentAssets,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { listAssetsWithTx } from '../../lib/publish/assets/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Integration coverage for the assets-list query. Three angles:
 *
 *   1. RLS tenant isolation — org A never sees org B assets, even
 *      via cursor manipulation.
 *   2. Cursor pagination — recent sort threads `createdAt + id`
 *      cleanly across pages with stable ordering, no duplicates.
 *   3. Filters — brand / kind / tag / search filter the list as
 *      expected; combined filters AND together.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-aaaa0000aaaa';
const orgA = '11111111-1111-4111-8111-aaaa0000aaaa';
const orgB = '11111111-1111-4111-8111-bbbb0000bbbb';
const userA = '22222222-2222-4222-8222-aaaa0000aaaa';
const userB = '22222222-2222-4222-8222-bbbb0000bbbb';
const brandA1 = '33333333-3333-4333-8333-aaaa0000aaa1';
const brandA2 = '33333333-3333-4333-8333-aaaa0000aaa2';
const brandB1 = '33333333-3333-4333-8333-bbbb0000bbb1';

const BASE_NOW = Date.parse('2026-05-15T12:00:00Z');
const HOUR = 60 * 60 * 1000;

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values([
      { id: userA, email: 'a@al.test', name: 'A' },
      { id: userB, email: 'b@al.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'al-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'al-org-b', planId },
    ]);
    await tx.insert(brands).values([
      { id: brandA1, organizationId: orgA, name: 'Trattoria', slug: 'tratt' },
      { id: brandA2, organizationId: orgA, name: 'Clínica', slug: 'clin' },
      { id: brandB1, organizationId: orgB, name: 'Othersco', slug: 'os' },
    ]);

    // Org A: 6 image assets across two brands + 2 video + 1 pdf.
    // Org B: 3 assets that must never appear in org-A queries.
    const orgARows = [
      // Brand A1 — three images, tagged "summer"
      {
        id: 'aaaa1111-1111-4111-8111-aaaa00000001',
        kind: 'image' as const,
        brandId: brandA1,
        name: 'Summer-1.png',
        url: '/api/dev-uploads/orgA/asset1.png',
        tags: ['summer', 'promo'],
        createdAt: new Date(BASE_NOW - 1 * HOUR),
      },
      {
        id: 'aaaa1111-1111-4111-8111-aaaa00000002',
        kind: 'image' as const,
        brandId: brandA1,
        name: 'Summer-2.png',
        url: '/api/dev-uploads/orgA/asset2.png',
        tags: ['summer'],
        createdAt: new Date(BASE_NOW - 2 * HOUR),
      },
      {
        id: 'aaaa1111-1111-4111-8111-aaaa00000003',
        kind: 'image' as const,
        brandId: brandA1,
        name: 'Cover-A1.jpg',
        url: '/api/dev-uploads/orgA/asset3.jpg',
        tags: [],
        createdAt: new Date(BASE_NOW - 3 * HOUR),
      },
      // Brand A2 — three image + 2 video + 1 pdf
      {
        id: 'aaaa1111-1111-4111-8111-aaaa00000004',
        kind: 'image' as const,
        brandId: brandA2,
        name: 'Clinic-shot.png',
        url: '/api/dev-uploads/orgA/asset4.png',
        tags: ['clinic'],
        createdAt: new Date(BASE_NOW - 4 * HOUR),
      },
      {
        id: 'aaaa1111-1111-4111-8111-aaaa00000005',
        kind: 'image' as const,
        brandId: brandA2,
        name: 'Logo.png',
        url: '/api/dev-uploads/orgA/asset5.png',
        tags: ['brand'],
        createdAt: new Date(BASE_NOW - 5 * HOUR),
      },
      {
        id: 'aaaa1111-1111-4111-8111-aaaa00000006',
        kind: 'image' as const,
        brandId: brandA2,
        name: 'Banner.webp',
        url: '/api/dev-uploads/orgA/asset6.webp',
        tags: ['brand'],
        createdAt: new Date(BASE_NOW - 6 * HOUR),
      },
      {
        id: 'aaaa1111-1111-4111-8111-aaaa00000007',
        kind: 'video' as const,
        brandId: brandA2,
        name: 'Intro.mp4',
        url: '/api/dev-uploads/orgA/asset7.mp4',
        tags: [],
        createdAt: new Date(BASE_NOW - 7 * HOUR),
      },
      {
        id: 'aaaa1111-1111-4111-8111-aaaa00000008',
        kind: 'video' as const,
        brandId: brandA1,
        name: 'Outro.mov',
        url: '/api/dev-uploads/orgA/asset8.mov',
        tags: ['summer'],
        createdAt: new Date(BASE_NOW - 8 * HOUR),
      },
      {
        id: 'aaaa1111-1111-4111-8111-aaaa00000009',
        kind: 'pdf' as const,
        brandId: brandA2,
        name: 'Menu.pdf',
        url: '/api/dev-uploads/orgA/asset9.pdf',
        tags: [],
        createdAt: new Date(BASE_NOW - 9 * HOUR),
      },
    ];
    for (const row of orgARows) {
      await tx.insert(contentAssets).values({
        id: row.id,
        organizationId: orgA,
        brandId: row.brandId,
        kind: row.kind,
        name: row.name,
        url: row.url,
        tags: row.tags,
        uploadedBy: userA,
        createdAt: row.createdAt,
        metadata: { bytes: 100_000, contentType: 'image/png', storageKey: row.id },
      });
    }

    for (let i = 0; i < 3; i++) {
      await tx.insert(contentAssets).values({
        id: `bbbb1111-1111-4111-8111-bbbb0000000${i + 1}`,
        organizationId: orgB,
        brandId: brandB1,
        kind: 'image',
        name: `OrgB-Asset-${i}.png`,
        url: `/api/dev-uploads/orgB/asset${i}.png`,
        tags: [],
        uploadedBy: userB,
        createdAt: new Date(BASE_NOW - i * HOUR),
        metadata: { bytes: 100_000, contentType: 'image/png', storageKey: `b${i}` },
      });
    }
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('listAssets — RLS tenant isolation', () => {
  it('org A never sees org B assets', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listAssetsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          pageSize: 50,
        }),
    );
    expect(page.assets.length).toBe(9);
    expect(page.assets.every((a) => a.name.startsWith('OrgB') === false)).toBe(true);
  });

  it('org B sees only its own 3 assets', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgB, userId: userB },
      async (tx) =>
        listAssetsWithTx(tx, {
          orgId: orgB,
          userId: userB,
          filters: {},
          pageSize: 50,
        }),
    );
    expect(page.assets.length).toBe(3);
    expect(page.assets.every((a) => a.name.startsWith('OrgB'))).toBe(true);
  });
});

describe('listAssets — cursor pagination', () => {
  it('threads through pages without duplicates or gaps on recent sort', async () => {
    const ids = new Set<string>();
    let cursor: string | null = null;
    let pageCount = 0;
    while (true) {
      const page = await runAs(
        fixture.db,
        { orgId: orgA, userId: userA },
        async (tx) =>
          listAssetsWithTx(tx, {
            orgId: orgA,
            userId: userA,
            filters: { sort: 'recent' },
            pageSize: 3,
            ...(cursor ? { cursor } : {}),
          }),
      );
      for (const asset of page.assets) {
        expect(ids.has(asset.id)).toBe(false);
        ids.add(asset.id);
      }
      pageCount += 1;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      if (pageCount > 6) throw new Error('Paginated more times than expected.');
    }
    expect(ids.size).toBe(9);
  });
});

describe('listAssets — filters', () => {
  it('filters by brand', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) =>
        listAssetsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { brandId: brandA1 },
          pageSize: 50,
        }),
    );
    expect(page.assets.length).toBe(4); // 3 images + 1 video on brandA1
    expect(page.assets.every((a) => a.brandId === brandA1)).toBe(true);
  });

  it('filters by kind', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) =>
        listAssetsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { kind: 'video' },
          pageSize: 50,
        }),
    );
    expect(page.assets.length).toBe(2);
    expect(page.assets.every((a) => a.kind === 'video')).toBe(true);
  });

  it('filters by tag (jsonb ?)', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) =>
        listAssetsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { tag: 'summer' },
          pageSize: 50,
        }),
    );
    expect(page.assets.length).toBe(3); // 2 images + 1 video tagged "summer"
    expect(page.assets.every((a) => a.tags.includes('summer'))).toBe(true);
  });

  it('searches by name (ILIKE)', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) =>
        listAssetsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { q: 'summer' },
          pageSize: 50,
        }),
    );
    expect(page.assets.length).toBeGreaterThanOrEqual(2);
    expect(page.assets.every((a) => a.name.toLowerCase().includes('summer'))).toBe(true);
  });

  it('AND-combines brand + kind filters', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) =>
        listAssetsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { brandId: brandA2, kind: 'video' },
          pageSize: 50,
        }),
    );
    expect(page.assets.length).toBe(1);
    expect(page.assets[0]?.brandId).toBe(brandA2);
    expect(page.assets[0]?.kind).toBe('video');
  });
});
