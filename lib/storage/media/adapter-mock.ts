import 'server-only';

import { PRESIGN_TTL_SEC, type MediaStorageAdapter } from './types';

/**
 * In-memory mock R2 adapter for dev/test — no network. Returns deterministic
 * `mock://` URLs and tracks "objects" so list/delete behave. Tenant isolation
 * is enforced upstream by RLS on `media_assets`, not here.
 */

const store = new Map<string, { contentType: string }>();

export const mockAdapter: MediaStorageAdapter = {
  async presignUpload(_bucket, key, contentType) {
    store.set(key, { contentType });
    return { url: `mock://upload/${key}`, expiresInSec: PRESIGN_TTL_SEC };
  },
  async presignDownload(_bucket, key) {
    return `mock://download/${key}`;
  },
  publicUrl(key) {
    return `mock://public/${key}`;
  },
  async deleteObject(_bucket, key) {
    store.delete(key);
  },
  async listKeys(_bucket, prefix) {
    return [...store.keys()].filter((k) => k.startsWith(prefix));
  },
};

/** Test seam. */
export function _clearMockStoreForTests(): void {
  store.clear();
}

export function _mockStoreHas(key: string): boolean {
  return store.has(key);
}
