import { env } from '../env';

import { DevFilesystemProvider } from './dev-filesystem-provider';
import type { StorageProvider } from './types';

/**
 * Process-level storage provider factory.
 *
 * # Phase 11 swap point
 *
 * Today the factory always returns `DevFilesystemProvider`. The
 * filesystem implementation is good enough for dev + integration
 * tests + the closed-beta demos that run on a single instance.
 *
 * At Phase 11 cutover this function will branch on
 * `env.BLACKNEL_USE_MOCKS`:
 *
 *   - `true`  → `DevFilesystemProvider` (still useful for local
 *                dev and tests after cutover),
 *   - `false` → `SupabaseStorageProvider` (real Storage bucket
 *                with signed URLs).
 *
 * Callers should NOT import `DevFilesystemProvider` directly —
 * use the factory so the cutover is a one-file change.
 */

let cachedProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cachedProvider) return cachedProvider;
  // Reading `env.BLACKNEL_USE_MOCKS` for symmetry with the
  // expected Phase 11 branch — for now both values resolve to
  // the dev provider.
  void env.BLACKNEL_USE_MOCKS;
  cachedProvider = new DevFilesystemProvider();
  return cachedProvider;
}

/**
 * Test seam: replace the cached singleton with a custom provider
 * (or `null` to force the next `getStorageProvider()` call to
 * rebuild from env). Production code never calls this.
 */
export function __setStorageProviderForTests(provider: StorageProvider | null): void {
  cachedProvider = provider;
}

export type { StorageProvider } from './types';
export type { UploadOpts, StoredAsset, AssetKind } from './types';
export {
  ALLOWED_EXTENSIONS,
  STORAGE_HARD_CAP_BYTES,
} from './types';
export { DevFilesystemProvider } from './dev-filesystem-provider';
