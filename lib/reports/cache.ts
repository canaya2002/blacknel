import { createHash } from 'node:crypto';

/**
 * In-process LRU cache for /reports aggregations (Phase 8 /
 * Commit 27, Ajuste 2).
 *
 * **Why a cache.** Reports queries scan windowed slices of
 * inbox messages + reviews + posts + ai_generations. A manager
 * refreshing the dashboard 3× per minute would otherwise pay
 * 3× the cost. The cache front-runs that with a 60-second TTL
 * — long enough to absorb back-to-back refreshes, short
 * enough that stale numbers don't accumulate.
 *
 * **Scope:** in-process LRU (max 100 entries). Phase 11 swap
 * to Redis or HTTP cache headers when the deployment shape
 * justifies it. The bypass path (`fresh=1`) lets a user force
 * a fresh read when they've just done a write and want to see
 * the impact immediately.
 *
 * Cache key includes `(orgId, period, brandId, section)` so
 * cross-tenant + cross-section leakage is impossible.
 */

const TTL_MS = 60_000;
const MAX_ENTRIES = 100;

interface CacheEntry {
  readonly value: unknown;
  readonly insertedAt: number;
}

class ReportsLru {
  private store = new Map<string, CacheEntry>();

  get(key: string): unknown | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.insertedAt > TTL_MS) {
      this.store.delete(key);
      return undefined;
    }
    // Move to tail (most-recent).
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: unknown): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { value, insertedAt: Date.now() });
    while (this.store.size > MAX_ENTRIES) {
      const first = this.store.keys().next().value;
      if (first === undefined) break;
      this.store.delete(first);
    }
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

const lru = new ReportsLru();

export interface ReportsCacheKey {
  readonly orgId: string;
  readonly section: string;
  readonly period: string;
  readonly brandId: string | null;
}

export function buildKey(k: ReportsCacheKey): string {
  const payload = `${k.orgId}|${k.section}|${k.period}|${k.brandId ?? ''}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Cache wrapper. When `bypass` is true (driven by the
 * `?fresh=1` query param), the function always computes fresh
 * and overwrites the entry.
 */
export async function withReportsCache<T>(
  key: ReportsCacheKey,
  bypass: boolean,
  compute: () => Promise<T>,
): Promise<T> {
  const hashed = buildKey(key);
  if (!bypass) {
    const hit = lru.get(hashed);
    if (hit !== undefined) {
      return hit as T;
    }
  }
  const value = await compute();
  lru.set(hashed, value);
  return value;
}

// Test seams.
export function _clearReportsCacheForTests(): void {
  lru.clear();
}

export function _reportsCacheSizeForTests(): number {
  return lru.size();
}

export const TTL_MS_EXPORT = TTL_MS;
