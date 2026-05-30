import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import { contentAssets, organizations, plans } from '../../lib/db/schema';
import { resolveMediaUrls } from '../../lib/jobs/publish-target';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C46 media resolution for publishing — content_assets ids → public URLs,
 * preserving the post's media order, dropping missing ids, and (defence in
 * depth) never crossing into another org's assets.
 */

let fixture: TestDb;
const asAdmin = <T>(fn: Parameters<typeof runAdmin<T>>[1]) => runAdmin(fixture.db, fn);

const planId = '00000000-0000-4000-8000-d46200000001';
const orgA = '46c44444-4444-4444-8462-a00000000001';
const orgB = '46c44444-4444-4444-8462-b00000000002';
const a1 = '46c77777-7777-4777-8772-a00000000001';
const a2 = '46c77777-7777-4777-8772-a00000000002';
const a3 = '46c77777-7777-4777-8772-a00000000003';
const bId = '46c77777-7777-4777-8772-b00000000001';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'standard', name: 'Standard', priceCents: 6900 });
    await tx.insert(organizations).values([
      { id: orgA, name: 'A', slug: 'mr-a', planId },
      { id: orgB, name: 'B', slug: 'mr-b', planId },
    ]);
    await tx.insert(contentAssets).values([
      { id: a1, organizationId: orgA, kind: 'image', url: 'https://cdn/a1.jpg', name: 'a1' },
      { id: a2, organizationId: orgA, kind: 'image', url: 'https://cdn/a2.jpg', name: 'a2' },
      { id: a3, organizationId: orgA, kind: 'video', url: 'https://cdn/a3.mp4', name: 'a3' },
      { id: bId, organizationId: orgB, kind: 'image', url: 'https://cdn/b.jpg', name: 'b' },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('resolveMediaUrls', () => {
  it('returns [] for no ids', async () => {
    expect(await resolveMediaUrls(asAdmin, orgA, [])).toEqual([]);
  });

  it('preserves the requested order', async () => {
    expect(await resolveMediaUrls(asAdmin, orgA, [a3, a1, a2])).toEqual([
      'https://cdn/a3.mp4',
      'https://cdn/a1.jpg',
      'https://cdn/a2.jpg',
    ]);
  });

  it('drops missing ids and never resolves another org assets', async () => {
    const missing = '46c77777-7777-4777-8772-a00000000099';
    const urls = await resolveMediaUrls(asAdmin, orgA, [a1, missing, bId, a2]);
    expect(urls).toEqual(['https://cdn/a1.jpg', 'https://cdn/a2.jpg']);
  });
});
