import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type AnyPgTx, runAdmin, runAs } from '../../lib/db/client';
import { contentAssets, mediaAssets, organizations, plans, users } from '../../lib/db/schema';
import { _resetFlagReaderForTests, _setFlagReaderForTests } from '../../lib/flags';
import { _setInngestEmitForTests } from '../../lib/inngest/client';
import {
  finalizeComposerUpload,
  requestComposerUpload,
  type ComposerUploadDeps,
} from '../../lib/publish/composer/media-upload';
import { _clearMockStoreForTests } from '../../lib/storage/media/adapter-mock';
import {
  _resetMediaDbDepsForTests,
  _setMediaAdapterForTests,
  _setMediaDbDepsForTests,
} from '../../lib/storage/media/client';
import { readUsage } from '../../lib/usage/counters';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C45 — composer media upload through C44 (Storage + Inngest), first real
 * consumer. Runs against in-memory pglite (real RLS) with the mock R2 adapter:
 * ZERO network. Exercises request (presigned PUT + pending media_assets row),
 * finalize (ready + media.process emit + mediaStorageBytes quota + content_assets
 * projection + assetsInLibrary bump), and tenant isolation (org B cannot
 * finalize org A's upload).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-d45000000001';
const orgA = '44444444-4444-4444-8450-a00000000001';
const orgB = '44444444-4444-4444-8450-b00000000002';
const userA = '55555555-5555-4555-8550-a00000000001';
const userB = '55555555-5555-4555-8550-b00000000002';

const emitted: Array<{ name: string; data: unknown }> = [];

let deps: ComposerUploadDeps;

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
      [orgA, 'cmu-a'],
      [orgB, 'cmu-b'],
    ] as const) {
      await tx.insert(organizations).values({ id, name: 'Composer Org', slug, planId });
    }
    await tx.insert(users).values([
      { id: userA, email: 'a@cmu.test', name: 'A' },
      { id: userB, email: 'b@cmu.test', name: 'B' },
    ]);
  });

  // C44 media client seams → pglite (RLS real).
  _setMediaDbDepsForTests({
    asUser: (ctx, fn) => runAs(fixture.db, ctx, fn),
    asAdmin: (fn) => runAdmin(fixture.db, fn),
  });
  // Flags OFF → mock R2 adapter (fail-safe), never a real PUT URL.
  _setFlagReaderForTests(() => Promise.resolve('off'));
  // Capture media.process emitted on finalize, no wire.
  _setInngestEmitForTests(async (name, data) => {
    emitted.push({ name, data });
  });
  // Projection seam for finalizeComposerUpload (content_assets + counter).
  deps = {
    asUser: <T>(ctx: { orgId: string; userId: string }, fn: (tx: AnyPgTx) => Promise<T>) =>
      runAs(fixture.db, ctx, fn),
    asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
  };
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

describe('requestComposerUpload', () => {
  it('reserves a pending media_assets row scoped to the org + flags it as mock', async () => {
    const res = await requestComposerUpload({
      orgId: orgA,
      userId: userA,
      plan: 'standard',
      contentType: 'image/png',
      originalFilename: 'hero.png',
      sizeBytes: 2048,
    });
    expect(res.isMock).toBe(true);
    expect(res.url).toBe(`mock://upload/${res.key}`);
    expect(res.key).toMatch(new RegExp(`^orgs/${orgA}/media/[0-9a-f-]{36}\\.png$`));

    const rows = await runAdmin<Array<{ status: string; organizationId: string }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ status: mediaAssets.status, organizationId: mediaAssets.organizationId })
          .from(mediaAssets)
          .where(eq(mediaAssets.id, res.assetId)),
    );
    expect(rows[0]).toMatchObject({ status: 'pending', organizationId: orgA });
  });
});

describe('finalizeComposerUpload', () => {
  it('marks ready, emits media.process, charges mediaStorageBytes, and projects a content_assets row', async () => {
    const req = await requestComposerUpload({
      orgId: orgA,
      userId: userA,
      plan: 'standard',
      contentType: 'image/jpeg',
      originalFilename: 'pic.jpg',
      sizeBytes: 7000,
    });
    const bytesBefore = await runAdmin<number>(fixture.db, (tx) =>
      readUsage(tx, orgA, 'mediaStorageBytes'),
    );
    const libBefore = await runAdmin<number>(fixture.db, (tx) =>
      readUsage(tx, orgA, 'assetsInLibrary'),
    );

    const asset = await finalizeComposerUpload(
      { orgId: orgA, userId: userA, assetId: req.assetId },
      deps,
    );

    // Returns an AssetListItem keyed by the projected content_assets id.
    expect(asset.id).not.toBe(req.assetId);
    expect(asset.kind).toBe('image');
    expect(asset.bytes).toBe(7000);
    expect(asset.storageKey).toBe(req.key);
    expect(asset.url).toBe(`mock://public/${req.key}`);

    // media_assets flipped to ready.
    const media = await runAdmin<Array<{ status: string }>>(fixture.db, (tx) =>
      tx.select({ status: mediaAssets.status }).from(mediaAssets).where(eq(mediaAssets.id, req.assetId)),
    );
    expect(media[0]?.status).toBe('ready');

    // content_assets projection persisted with the back-reference.
    const proj = await runAdmin<Array<{ url: string; metadata: unknown; organizationId: string }>>(
      fixture.db,
      (tx) =>
        tx
          .select({
            url: contentAssets.url,
            metadata: contentAssets.metadata,
            organizationId: contentAssets.organizationId,
          })
          .from(contentAssets)
          .where(eq(contentAssets.id, asset.id)),
    );
    expect(proj[0]?.organizationId).toBe(orgA);
    expect((proj[0]?.metadata as { mediaAssetId?: string }).mediaAssetId).toBe(req.assetId);

    // media.process emitted; quota metered once on mediaStorageBytes, library
    // count bumped, storageBytes left untouched (no double byte-charge).
    expect(emitted).toContainEqual({
      name: 'media.process',
      data: { orgId: orgA, assetId: req.assetId },
    });
    const bytesAfter = await runAdmin<number>(fixture.db, (tx) =>
      readUsage(tx, orgA, 'mediaStorageBytes'),
    );
    const libAfter = await runAdmin<number>(fixture.db, (tx) =>
      readUsage(tx, orgA, 'assetsInLibrary'),
    );
    const storageBytes = await runAdmin<number>(fixture.db, (tx) =>
      readUsage(tx, orgA, 'storageBytes'),
    );
    expect(bytesAfter - bytesBefore).toBe(7000);
    expect(libAfter - libBefore).toBe(1);
    expect(storageBytes).toBe(0);
  });

  it('does not let org B finalize org A pending upload (not_found via RLS)', async () => {
    const req = await requestComposerUpload({
      orgId: orgA,
      userId: userA,
      plan: 'standard',
      contentType: 'image/webp',
      originalFilename: 'iso.webp',
      sizeBytes: 1500,
    });
    await expect(
      finalizeComposerUpload({ orgId: orgB, userId: userB, assetId: req.assetId }, deps),
    ).rejects.toMatchObject({ code: 'not_found' });

    // org A asset stayed pending; org B created no content_assets row.
    const stillPending = await runAdmin<Array<{ status: string }>>(fixture.db, (tx) =>
      tx.select({ status: mediaAssets.status }).from(mediaAssets).where(eq(mediaAssets.id, req.assetId)),
    );
    expect(stillPending[0]?.status).toBe('pending');
    const bProjections = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx
        .select({ id: contentAssets.id })
        .from(contentAssets)
        .where(eq(contentAssets.organizationId, orgB)),
    );
    expect(bProjections).toHaveLength(0);
  });
});

describe('tenant isolation of the projected library row', () => {
  it('a finalized asset projection is visible to org A only', async () => {
    const req = await requestComposerUpload({
      orgId: orgA,
      userId: userA,
      plan: 'standard',
      contentType: 'image/png',
      originalFilename: 'vis.png',
      sizeBytes: 999,
    });
    const asset = await finalizeComposerUpload(
      { orgId: orgA, userId: userA, assetId: req.assetId },
      deps,
    );
    const seenByA = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      tx
        .select({ id: contentAssets.id })
        .from(contentAssets)
        .where(and(eq(contentAssets.id, asset.id), eq(contentAssets.organizationId, orgA))),
    );
    const seenByB = await runAs(fixture.db, { orgId: orgB, userId: userB }, (tx) =>
      tx.select({ id: contentAssets.id }).from(contentAssets).where(eq(contentAssets.id, asset.id)),
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByB).toHaveLength(0);
  });
});
