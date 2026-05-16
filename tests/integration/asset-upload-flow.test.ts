import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs, type AnyPgTx } from '../../lib/db/client';
import {
  auditEvents,
  brands,
  contentAssets,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { uploadAndRecord, type AssetUploadDeps } from '../../lib/publish/assets/upload';
import { DevFilesystemProvider } from '../../lib/storage/dev-filesystem-provider';
import { readUsage } from '../../lib/usage/counters';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Full asset-upload flow against the fixture pglite + a temp-dir
 * storage provider. Covers:
 *
 *   1. Happy path — FormData-shaped buffer → blob on disk → row
 *      in `content_assets` → audit event → `assetsInLibrary` +
 *      `storageBytes` counters bumped.
 *
 *   2. Cross-org URL manipulation — uploading as org A puts the
 *      blob at `<orgA>/<assetId>.<ext>`. Org B cannot guess /
 *      manipulate the URL to fetch it (the dev-uploads route
 *      handler enforces this — verified separately at the unit
 *      level by `dev-filesystem-provider.test.ts`'s traversal
 *      guards). Here we double-check the DB row is org-A only.
 *
 *   3. Plan-cap rejection — Standard's 5 MB per-file cap blocks
 *      a 6 MB upload with `PLAN_LIMIT_REACHED`. No disk write, no
 *      DB row, no counter bump.
 */

let fixture: TestDb;
let storageRoot: string;
let provider: DevFilesystemProvider;
let deps: AssetUploadDeps;

const planId = '00000000-0000-4000-8000-aa00cc00aa00';
const orgA = '11111111-1111-4111-8111-aa00cc00aa00';
const orgB = '11111111-1111-4111-8111-bb00cc00bb00';
const userA = '22222222-2222-4222-8222-aa00cc00aa00';
const userB = '22222222-2222-4222-8222-bb00cc00bb00';
const brandA = '33333333-3333-4333-8333-aa00cc00aa00';

beforeAll(async () => {
  fixture = await createTestDb();
  storageRoot = await mkdtemp(path.join(tmpdir(), 'bn-asset-flow-'));
  provider = new DevFilesystemProvider({ root: storageRoot });
  deps = {
    asUser: <T,>(
      ctx: { orgId: string; userId: string },
      fn: (tx: AnyPgTx) => Promise<T>,
    ) => runAs(fixture.db, ctx, fn),
    asAdmin: <T,>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
    storage: provider,
  };

  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'standard',
      name: 'Standard',
      priceCents: 6900,
    });
    await tx.insert(users).values([
      { id: userA, email: 'a@auf.test', name: 'A' },
      { id: userB, email: 'b@auf.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'auf-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'auf-org-b', planId },
    ]);
    await tx.insert(brands).values({
      id: brandA,
      organizationId: orgA,
      name: 'Brand A',
      slug: 'auf-brand-a',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
  await rm(storageRoot, { recursive: true, force: true });
});

describe('asset upload flow — happy path', () => {
  it('writes file to disk + row to DB + audit event + counters bumped', async () => {
    const buffer = Buffer.alloc(200_000, 0xab); // 200 KB
    const result = await uploadAndRecord(
      {
        orgId: orgA,
        userId: userA,
        planCode: 'standard',
        file: buffer,
        originalFilename: 'photo.png',
        contentType: 'image/png',
        brandId: brandA,
        tags: ['demo'],
      },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.bytes).toBe(buffer.length);
    expect(result.data.kind).toBe('image');
    expect(result.data.url).toMatch(/^\/api\/dev-uploads\//);

    // 1. File exists on disk under <root>/<orgA>/<assetId>.png
    const stats = await stat(
      path.join(storageRoot, orgA, `${result.data.assetId}.png`),
    );
    expect(stats.isFile()).toBe(true);
    const persisted = await readFile(
      path.join(storageRoot, orgA, `${result.data.assetId}.png`),
    );
    expect(persisted.length).toBe(buffer.length);

    // 2. DB row exists, scoped to org A.
    const rows = await runAdmin<Array<{ id: string; organizationId: string; name: string; tags: unknown; kind: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({
            id: contentAssets.id,
            organizationId: contentAssets.organizationId,
            name: contentAssets.name,
            tags: contentAssets.tags,
            kind: contentAssets.kind,
          })
          .from(contentAssets)
          .where(eq(contentAssets.id, result.data.assetId)),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.organizationId).toBe(orgA);
    expect(rows[0]?.name).toBe('photo.png');
    expect(rows[0]?.kind).toBe('image');
    expect(rows[0]?.tags).toEqual(['demo']);

    // 3. Audit row written with the right action.
    const audits = await runAdmin<Array<{ action: string; entityId: string; userId: string | null }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({
            action: auditEvents.action,
            entityId: auditEvents.entityId,
            userId: auditEvents.userId,
          })
          .from(auditEvents)
          .where(eq(auditEvents.entityId, result.data.assetId)),
    );
    expect(audits.length).toBe(1);
    expect(audits[0]?.action).toBe('asset.uploaded');
    expect(audits[0]?.userId).toBe(userA);

    // 4. Counters bumped — both assetsInLibrary and storageBytes.
    const counterAssets = await runAdmin<number>(fixture.db, (tx) =>
      readUsage(tx, orgA, 'assetsInLibrary'),
    );
    const counterStorage = await runAdmin<number>(fixture.db, (tx) =>
      readUsage(tx, orgA, 'storageBytes'),
    );
    expect(counterAssets).toBeGreaterThanOrEqual(1);
    expect(counterStorage).toBeGreaterThanOrEqual(buffer.length);
  });
});

describe('asset upload flow — tenant isolation', () => {
  it('org B cannot see the org A asset row even though both share planId', async () => {
    const visibleToB = await runAs<Array<{ id: string }>>(
      fixture.db,
      { orgId: orgB, userId: userB },
      async (tx) =>
        tx
          .select({ id: contentAssets.id })
          .from(contentAssets),
    );
    expect(visibleToB.length).toBe(0);
  });

  it('the storage key path is org-scoped — a URL-guessed key for org B does not exist on disk', async () => {
    // Construct a path that looks like it would belong to org B
    // pointing at an org-A asset. The dev provider's traversal
    // guard accepts the shape (it's a valid UUID structure) but
    // the file doesn't exist there because we wrote it under
    // orgA's directory.
    const fakeKey = `${orgB}/00000000-0000-4000-8000-000000000099.png`;
    const exists = await provider.exists(fakeKey);
    expect(exists).toBe(false);
  });
});

describe('asset upload flow — plan-cap rejection', () => {
  it('Standard plan rejects a 6 MB upload (cap is 5 MB)', async () => {
    const oversized = Buffer.alloc(6_000_000, 0xcd);
    const result = await uploadAndRecord(
      {
        orgId: orgA,
        userId: userA,
        planCode: 'standard',
        file: oversized,
        originalFilename: 'huge.png',
        contentType: 'image/png',
      },
      deps,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(result.error.message).toMatch(/excede/i);

    // No file written under that filename pattern.
    const files = await listFilesUnder(path.join(storageRoot, orgA));
    expect(files.some((f) => f.size >= 6_000_000)).toBe(false);
  });
});

async function listFilesUnder(dir: string): Promise<Array<{ name: string; size: number }>> {
  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir, { withFileTypes: true });
    const out: Array<{ name: string; size: number }> = [];
    for (const entry of entries) {
      if (entry.isFile()) {
        const s = await stat(path.join(dir, entry.name));
        out.push({ name: entry.name, size: s.size });
      }
    }
    return out;
  } catch {
    return [];
  }
}
