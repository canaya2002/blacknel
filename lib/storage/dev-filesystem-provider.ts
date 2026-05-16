import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import {
  ALLOWED_EXTENSIONS,
  STORAGE_HARD_CAP_BYTES,
  type StorageProvider,
  type StoredAsset,
  type UploadOpts,
} from './types';

/**
 * Filesystem-backed `StorageProvider` for the dev runtime. Files
 * live at `.blacknel/dev-uploads/<orgId>/<assetId>.<ext>` relative
 * to the project root.
 *
 * # Security posture
 *
 * Every path component the caller supplies is validated:
 *
 *   - `orgId` and `assetId` must parse as UUIDs (the upload
 *     orchestrator generates the `assetId`, the session supplies
 *     the `orgId`).
 *
 *   - The extension is derived from `originalFilename`, lower-
 *     cased, and checked against a whitelist
 *     (`ALLOWED_EXTENSIONS`). Anything not in the set throws.
 *
 *   - After constructing the absolute path, we re-resolve it and
 *     assert it still starts with the storage root. A
 *     constructed `..` in either component would slip past the
 *     UUID regex but the re-resolution guard catches it.
 *
 * Files are written via `writeFile` (overwrite semantics on
 * collision — the orchestrator generates fresh UUIDs so this
 * normally never collides). The directory is created lazily
 * with `mkdir({ recursive: true })`; idempotent across requests.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORAGE_ROOT = path.resolve(process.cwd(), '.blacknel', 'dev-uploads');

const uploadOptsSchema = z.object({
  orgId: z.string().regex(UUID_RE),
  assetId: z.string().regex(UUID_RE),
  originalFilename: z.string().min(1).max(256),
  contentType: z.string().min(1).max(128),
  kind: z.enum(['image', 'video', 'pdf', 'gif']),
});

export class DevFilesystemProvider implements StorageProvider {
  /** Override of the storage root — primarily for tests. */
  private readonly root: string;

  constructor(opts?: { root?: string }) {
    this.root = opts?.root ?? STORAGE_ROOT;
  }

  async upload(file: Buffer, rawOpts: UploadOpts): Promise<StoredAsset> {
    const opts = uploadOptsSchema.parse(rawOpts);
    if (file.length > STORAGE_HARD_CAP_BYTES) {
      throw new Error(
        `Asset exceeds storage hard cap (${file.length} > ${STORAGE_HARD_CAP_BYTES} bytes).`,
      );
    }
    const ext = this.extensionOf(opts.originalFilename);
    const key = this.composeKey(opts.orgId, opts.assetId, ext);
    const abs = this.resolveAndGuard(key);

    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, file);

    return {
      key,
      bytes: file.length,
      contentType: opts.contentType,
    };
  }

  getUrl(key: string): string {
    // Caller is responsible for passing a key returned by `upload`.
    // We do NOT pre-resolve here — the route handler re-validates
    // when the URL is hit.
    return `/api/dev-uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    let abs: string;
    try {
      abs = this.resolveAndGuard(key);
    } catch {
      // Invalid key → treat as already-gone (idempotent).
      return;
    }
    try {
      await unlink(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    let abs: string;
    try {
      abs = this.resolveAndGuard(key);
    } catch {
      return false;
    }
    try {
      const stats = await stat(abs);
      return stats.isFile();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  }

  /**
   * Reads the file back into memory. NOT part of the
   * `StorageProvider` contract — only the `/api/dev-uploads`
   * route handler uses it because the dev provider doesn't speak
   * a streaming protocol like S3. Phase 11 callers go through
   * signed URLs and never call this.
   */
  async read(key: string): Promise<Buffer | null> {
    let abs: string;
    try {
      abs = this.resolveAndGuard(key);
    } catch {
      return null;
    }
    try {
      return await readFile(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private composeKey(orgId: string, assetId: string, ext: string): string {
    return `${orgId}/${assetId}${ext}`;
  }

  private extensionOf(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(
        `Unsupported file extension: ${ext || '(none)'}. Allowed: ${[
          ...ALLOWED_EXTENSIONS,
        ].join(', ')}.`,
      );
    }
    return ext;
  }

  /**
   * Resolves `<root>/<key>` and asserts the result still lives
   * under `root`. A key like `../etc/passwd` would resolve
   * outside and trip the guard — even if the UUID regex missed
   * it for some reason. Belt and suspenders.
   */
  private resolveAndGuard(key: string): string {
    // Reject path components that allow traversal — caller is
    // expected to pass `<uuid>/<uuid>.<ext>` only.
    if (key.includes('..') || key.includes('\\') || key.startsWith('/')) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    const segments = key.split('/');
    if (segments.length !== 2) {
      throw new Error(`Invalid storage key shape: ${key}`);
    }
    const [orgSegment, fileSegment] = segments;
    if (!orgSegment || !UUID_RE.test(orgSegment)) {
      throw new Error(`Invalid storage key orgId: ${key}`);
    }
    if (!fileSegment) {
      throw new Error(`Invalid storage key filename: ${key}`);
    }
    const ext = path.extname(fileSegment).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(`Invalid storage key extension: ${key}`);
    }
    const stem = path.basename(fileSegment, ext);
    if (!UUID_RE.test(stem)) {
      throw new Error(`Invalid storage key filename stem: ${key}`);
    }

    const abs = path.resolve(this.root, key);
    const rootResolved = path.resolve(this.root);
    if (!abs.startsWith(rootResolved + path.sep) && abs !== rootResolved) {
      throw new Error(`Storage key escapes root: ${key}`);
    }
    return abs;
  }
}
