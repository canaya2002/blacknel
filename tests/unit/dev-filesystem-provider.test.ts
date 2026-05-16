import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DevFilesystemProvider } from '../../lib/storage/dev-filesystem-provider';

/**
 * Unit coverage for `DevFilesystemProvider`. Uses a per-suite
 * temp directory so the tests never touch the real
 * `.blacknel/dev-uploads/` and clean up after themselves.
 *
 * Three concern areas:
 *
 *   1. Happy path — upload/getUrl/exists/delete round-trip.
 *   2. Path traversal — `..` and absolute-style keys must be
 *      rejected, regardless of which provider method is invoked.
 *   3. Extension whitelist — known good extensions accepted,
 *      anything outside the allowlist throws.
 */

const ORG_ID = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const ASSET_ID_A = '22222222-2222-4222-8222-aaaaaaaaaaaa';
const ASSET_ID_B = '33333333-3333-4333-8333-aaaaaaaaaaaa';

let root: string;
let provider: DevFilesystemProvider;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'bn-dev-storage-'));
  provider = new DevFilesystemProvider({ root });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('DevFilesystemProvider — happy path', () => {
  it('upload writes the file under <root>/<orgId>/<assetId>.<ext>', async () => {
    const buffer = Buffer.from('PNG-FAKE-CONTENTS');
    const stored = await provider.upload(buffer, {
      orgId: ORG_ID,
      assetId: ASSET_ID_A,
      originalFilename: 'photo.png',
      contentType: 'image/png',
      kind: 'image',
    });
    expect(stored.key).toBe(`${ORG_ID}/${ASSET_ID_A}.png`);
    expect(stored.bytes).toBe(buffer.length);
    expect(stored.contentType).toBe('image/png');

    const abs = path.join(root, stored.key);
    const stats = await stat(abs);
    expect(stats.isFile()).toBe(true);
    const persisted = await readFile(abs);
    expect(persisted.toString()).toBe('PNG-FAKE-CONTENTS');
  });

  it('getUrl returns /api/dev-uploads/<key>', () => {
    expect(provider.getUrl(`${ORG_ID}/${ASSET_ID_A}.png`)).toBe(
      `/api/dev-uploads/${ORG_ID}/${ASSET_ID_A}.png`,
    );
  });

  it('exists returns true for a written file, false after delete', async () => {
    const key = `${ORG_ID}/${ASSET_ID_A}.png`;
    expect(await provider.exists(key)).toBe(true);
    await provider.delete(key);
    expect(await provider.exists(key)).toBe(false);
  });

  it('delete is idempotent — missing keys resolve without throwing', async () => {
    const key = `${ORG_ID}/${ASSET_ID_B}.jpg`;
    await expect(provider.delete(key)).resolves.toBeUndefined();
    expect(await provider.exists(key)).toBe(false);
  });

  it('read returns the buffer for an existing file, null otherwise', async () => {
    const buffer = Buffer.from('JPEG-DATA');
    await provider.upload(buffer, {
      orgId: ORG_ID,
      assetId: ASSET_ID_B,
      originalFilename: 'banner.jpg',
      contentType: 'image/jpeg',
      kind: 'image',
    });
    const read = await provider.read(`${ORG_ID}/${ASSET_ID_B}.jpg`);
    expect(read).not.toBeNull();
    expect(read?.toString()).toBe('JPEG-DATA');

    const missing = await provider.read(
      `${ORG_ID}/44444444-4444-4444-8444-aaaaaaaaaaaa.png`,
    );
    expect(missing).toBeNull();
  });
});

describe('DevFilesystemProvider — path traversal & sanitization', () => {
  it('rejects upload when orgId is not a UUID', async () => {
    await expect(
      provider.upload(Buffer.from('x'), {
        orgId: '..',
        assetId: ASSET_ID_A,
        originalFilename: 'x.png',
        contentType: 'image/png',
        kind: 'image',
      }),
    ).rejects.toThrow();
  });

  it('rejects upload when assetId is not a UUID', async () => {
    await expect(
      provider.upload(Buffer.from('x'), {
        orgId: ORG_ID,
        assetId: '../etc/passwd',
        originalFilename: 'x.png',
        contentType: 'image/png',
        kind: 'image',
      }),
    ).rejects.toThrow();
  });

  it('rejects upload when the extension is outside the allowlist', async () => {
    await expect(
      provider.upload(Buffer.from('x'), {
        orgId: ORG_ID,
        assetId: ASSET_ID_A,
        originalFilename: 'malicious.exe',
        contentType: 'application/octet-stream',
        kind: 'image',
      }),
    ).rejects.toThrow(/extension/i);
  });

  it('rejects upload when filename has no extension', async () => {
    await expect(
      provider.upload(Buffer.from('x'), {
        orgId: ORG_ID,
        assetId: ASSET_ID_A,
        originalFilename: 'no-extension',
        contentType: 'image/png',
        kind: 'image',
      }),
    ).rejects.toThrow();
  });

  it('exists returns false for traversal-shaped keys', async () => {
    expect(await provider.exists('../../../etc/passwd')).toBe(false);
    expect(await provider.exists('/etc/passwd')).toBe(false);
    expect(await provider.exists('not-a-uuid/file.png')).toBe(false);
  });

  it('delete on traversal-shaped keys resolves without escaping the root', async () => {
    // Should be a no-op (idempotent) — the guard catches the key
    // before the unlink is issued.
    await expect(provider.delete('../../../etc/passwd')).resolves.toBeUndefined();
  });

  it('read on traversal-shaped keys returns null', async () => {
    expect(await provider.read('../etc/passwd')).toBeNull();
    expect(await provider.read('/absolute/path.png')).toBeNull();
  });

  it('rejects keys with backslashes or double-dot segments', async () => {
    expect(await provider.exists('orgId\\file.png')).toBe(false);
    expect(await provider.exists(`${ORG_ID}/..\\..\\file.png`)).toBe(false);
  });
});

describe('DevFilesystemProvider — extension whitelist coverage', () => {
  it.each([
    ['image.png', 'image/png', 'image'],
    ['photo.jpg', 'image/jpeg', 'image'],
    ['photo.JPG', 'image/jpeg', 'image'],
    ['banner.webp', 'image/webp', 'image'],
    ['anim.gif', 'image/gif', 'gif'],
    ['clip.mp4', 'video/mp4', 'video'],
    ['clip.mov', 'video/quicktime', 'video'],
    ['clip.webm', 'video/webm', 'video'],
    ['doc.pdf', 'application/pdf', 'pdf'],
  ] as const)('accepts %s', async (filename, contentType, kind) => {
    const assetId = '55555555-5555-4555-8555-aaaaaaaaaa'.padEnd(36, 'a');
    const stored = await provider.upload(Buffer.from('x'), {
      orgId: ORG_ID,
      assetId,
      originalFilename: filename,
      contentType,
      kind,
    });
    expect(stored.key.endsWith(path.extname(filename).toLowerCase())).toBe(true);
    await provider.delete(stored.key);
  });

  it.each(['.exe', '.svg', '.html', '.zip'])(
    'rejects %s extension',
    async (ext) => {
      await expect(
        provider.upload(Buffer.from('x'), {
          orgId: ORG_ID,
          assetId: ASSET_ID_A,
          originalFilename: `evil${ext}`,
          contentType: 'application/octet-stream',
          kind: 'image',
        }),
      ).rejects.toThrow();
    },
  );
});
