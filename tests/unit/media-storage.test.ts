import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import { mediaAssets, organizations, plans, users } from '../../lib/db/schema';
import { _resetFlagReaderForTests, _setFlagReaderForTests } from '../../lib/flags';
import { _setInngestEmitForTests } from '../../lib/inngest/client';
import {
  _clearMockStoreForTests,
  _mockStoreHas,
} from '../../lib/storage/media/adapter-mock';
import {
  MediaError,
  _resetMediaDbDepsForTests,
  _setMediaAdapterForTests,
  _setMediaDbDepsForTests,
  deleteAsset,
  finalizeUpload,
  getDownloadUrl,
  listAssets,
  requestUpload,
} from '../../lib/storage/media/client';
import { MAX_MEDIA_BYTES } from '../../lib/storage/media/types';
import { readUsage } from '../../lib/usage/counters';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C44 storage subsystem. Runs against in-memory pglite (real RLS) with the
 * in-memory mock R2 adapter — ZERO network. Exercises namespacing, presigned
 * issuance, metadata persistence, tenant isolation (org A ≠ org B via RLS),
 * quota gating, delete + quota release, and the fail-safe-to-mock gate.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-d00000000001';
const orgA = '44444444-4444-4444-8444-a00000000001';
const orgB = '44444444-4444-4444-8444-b00000000002';
const orgQuota = '44444444-4444-4444-8444-c00000000003';
const userA = '55555555-5555-4555-8555-a00000000001';
const userB = '55555555-5555-4555-8555-b00000000002';

const emitted: Array<{ name: string; data: unknown }> = [];

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'standard',
      name: 'Standard',
      priceCents: 6900,
    });
    for (const [id, slug] of [
      [orgA, 'media-a'],
      [orgB, 'media-b'],
      [orgQuota, 'media-q'],
    ] as const) {
      await tx.insert(organizations).values({ id, name: 'Media Org', slug, planId });
    }
    await tx.insert(users).values([
      { id: userA, email: 'a@media.test', name: 'A' },
      { id: userB, email: 'b@media.test', name: 'B' },
    ]);
  });

  // Bind DB seams to the pglite fixture. RLS is real: asUser → role
  // `authenticated` with the org/user session vars set.
  _setMediaDbDepsForTests({
    asUser: (ctx, fn) => runAs(fixture.db, ctx, fn),
    asAdmin: (fn) => runAdmin(fixture.db, fn),
  });
  // Flags ship OFF — the real R2 adapter is never selected (fail-safe to mock).
  _setFlagReaderForTests(() => Promise.resolve('off'));
  // Capture emitted Inngest events (media.process on finalize) without a wire.
  _setInngestEmitForTests(async (name, data) => {
    emitted.push({ name, data });
  });
}, 60_000);

afterAll(async () => {
  _resetMediaDbDepsForTests();
  _resetFlagReaderForTests();
  _setInngestEmitForTests(null);
  _setMediaAdapterForTests(null);
  await fixture.dispose();
});

beforeEach(() => {
  _clearMockStoreForTests();
  emitted.length = 0;
});

describe('requestUpload — validation', () => {
  it('rejects a disallowed content-type (invalid_type)', async () => {
    await expect(
      requestUpload({
        orgId: orgA,
        userId: userA,
        plan: 'standard',
        contentType: 'application/zip',
        originalFilename: 'x.zip',
        sizeBytes: 100,
      }),
    ).rejects.toMatchObject({ code: 'invalid_type' });
  });

  it('rejects an oversized upload (too_large)', async () => {
    await expect(
      requestUpload({
        orgId: orgA,
        userId: userA,
        plan: 'standard',
        contentType: 'image/png',
        originalFilename: 'big.png',
        sizeBytes: MAX_MEDIA_BYTES + 1,
      }),
    ).rejects.toMatchObject({ code: 'too_large' });
  });

  it('rejects a zero/negative size (too_large)', async () => {
    await expect(
      requestUpload({
        orgId: orgA,
        userId: userA,
        plan: 'standard',
        contentType: 'image/png',
        originalFilename: 'empty.png',
        sizeBytes: 0,
      }),
    ).rejects.toBeInstanceOf(MediaError);
  });
});

describe('requestUpload — namespacing, presign, metadata, fail-safe', () => {
  it('namespaces the key as orgs/{orgId}/media/{uuid}.{ext} and returns a mock presigned PUT', async () => {
    const res = await requestUpload({
      orgId: orgA,
      userId: userA,
      plan: 'standard',
      contentType: 'image/png',
      originalFilename: 'photo.png',
      sizeBytes: 1234,
    });
    expect(res.key).toMatch(
      new RegExp(`^orgs/${orgA}/media/[0-9a-f-]{36}\\.png$`),
    );
    // Fail-safe: flags OFF → mock adapter, never a real R2 URL.
    expect(res.url).toBe(`mock://upload/${res.key}`);
    expect(res.url.startsWith('mock://')).toBe(true);
    expect(res.expiresInSec).toBe(600);
  });

  it('persists a pending media_assets row with the upload metadata', async () => {
    const res = await requestUpload({
      orgId: orgA,
      userId: userA,
      plan: 'standard',
      contentType: 'video/mp4',
      originalFilename: 'clip.mp4',
      sizeBytes: 9999,
    });
    const rows = await runAdmin<
      Array<{
        contentType: string;
        sizeBytes: number;
        originalFilename: string;
        status: string;
        uploadedBy: string | null;
      }>
    >(fixture.db, (tx) =>
      tx
        .select({
          contentType: mediaAssets.contentType,
          sizeBytes: mediaAssets.sizeBytes,
          originalFilename: mediaAssets.originalFilename,
          status: mediaAssets.status,
          uploadedBy: mediaAssets.uploadedBy,
        })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, res.assetId)),
    );
    expect(rows[0]).toMatchObject({
      contentType: 'video/mp4',
      sizeBytes: 9999,
      originalFilename: 'clip.mp4',
      status: 'pending',
      uploadedBy: userA,
    });
    expect(res.key.endsWith('.mp4')).toBe(true);
  });
});

describe('finalizeUpload — charges quota + emits media.process', () => {
  it('flips pending→ready, increments mediaStorageBytes, emits the process event', async () => {
    const res = await requestUpload({
      orgId: orgA,
      userId: userA,
      plan: 'standard',
      contentType: 'image/jpeg',
      originalFilename: 'p.jpg',
      sizeBytes: 5000,
    });
    const before = await runAdmin<number>(fixture.db, (tx) =>
      readUsage(tx, orgA, 'mediaStorageBytes'),
    );
    await finalizeUpload({ orgId: orgA, userId: userA, assetId: res.assetId });
    const after = await runAdmin<number>(fixture.db, (tx) =>
      readUsage(tx, orgA, 'mediaStorageBytes'),
    );
    expect(after - before).toBe(5000);
    expect(emitted).toContainEqual({
      name: 'media.process',
      data: { orgId: orgA, assetId: res.assetId },
    });
  });

  it('throws not_found when finalizing an unknown/foreign asset', async () => {
    await expect(
      finalizeUpload({
        orgId: orgA,
        userId: userA,
        assetId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('tenant isolation (RLS: org A ≠ org B)', () => {
  it('an asset created by org A is invisible to org B; visible to org A', async () => {
    const res = await requestUpload({
      orgId: orgA,
      userId: userA,
      plan: 'standard',
      contentType: 'image/webp',
      originalFilename: 'iso.webp',
      sizeBytes: 4242,
    });
    await finalizeUpload({ orgId: orgA, userId: userA, assetId: res.assetId });

    const seenByA = await listAssets({ orgId: orgA, userId: userA });
    const seenByB = await listAssets({ orgId: orgB, userId: userB });
    expect(seenByA.some((a) => a.id === res.assetId)).toBe(true);
    expect(seenByB.some((a) => a.id === res.assetId)).toBe(false);
  });

  it('org B cannot download org A asset (resolves not_found via RLS)', async () => {
    const res = await requestUpload({
      orgId: orgA,
      userId: userA,
      plan: 'standard',
      contentType: 'image/png',
      originalFilename: 'dl.png',
      sizeBytes: 100,
    });
    await finalizeUpload({ orgId: orgA, userId: userA, assetId: res.assetId });
    // org A can.
    await expect(
      getDownloadUrl({ orgId: orgA, userId: userA, assetId: res.assetId }),
    ).resolves.toBe(`mock://download/${res.key}`);
    // org B cannot — the row is filtered out by RLS, so it looks absent.
    await expect(
      getDownloadUrl({ orgId: orgB, userId: userB, assetId: res.assetId }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('org B cannot delete org A asset (not_found)', async () => {
    const res = await requestUpload({
      orgId: orgA,
      userId: userA,
      plan: 'standard',
      contentType: 'image/png',
      originalFilename: 'del.png',
      sizeBytes: 100,
    });
    await expect(
      deleteAsset({ orgId: orgB, userId: userB, assetId: res.assetId }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('quota gating', () => {
  it('throws quota_exceeded when the plan media cap is reached', async () => {
    // Standard mediaStorageBytes cap = 1 GB. Pin the counter at the cap.
    await runAdmin(fixture.db, (tx) =>
      tx.insert(mediaAssets).values({
        organizationId: orgQuota,
        key: `orgs/${orgQuota}/media/seed.png`,
        bucket: 'b',
        contentType: 'image/png',
        sizeBytes: 1,
        originalFilename: 's.png',
        status: 'ready',
      }),
    );
    await runAdmin(fixture.db, async (tx) => {
      const { incrementUsage } = await import('../../lib/usage/counters');
      await incrementUsage(tx, orgQuota, 'mediaStorageBytes', 1_000_000_000);
    });
    await expect(
      requestUpload({
        orgId: orgQuota,
        userId: userA,
        plan: 'standard',
        contentType: 'image/png',
        originalFilename: 'over.png',
        sizeBytes: 1,
      }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
  });
});

describe('deleteAsset — releases quota + removes the object', () => {
  it('soft-deletes, decrements the counter, and deletes the mock object', async () => {
    const res = await requestUpload({
      orgId: orgA,
      userId: userA,
      plan: 'standard',
      contentType: 'image/png',
      originalFilename: 'gone.png',
      sizeBytes: 3000,
    });
    await finalizeUpload({ orgId: orgA, userId: userA, assetId: res.assetId });
    expect(_mockStoreHas(res.key)).toBe(true);
    const before = await runAdmin<number>(fixture.db, (tx) =>
      readUsage(tx, orgA, 'mediaStorageBytes'),
    );

    await deleteAsset({ orgId: orgA, userId: userA, assetId: res.assetId });

    const after = await runAdmin<number>(fixture.db, (tx) =>
      readUsage(tx, orgA, 'mediaStorageBytes'),
    );
    expect(before - after).toBe(3000);
    expect(_mockStoreHas(res.key)).toBe(false);
    // Idempotent: a second delete does not throw.
    await expect(
      deleteAsset({ orgId: orgA, userId: userA, assetId: res.assetId }),
    ).resolves.toBeUndefined();
  });
});
