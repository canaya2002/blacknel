import { createHash } from 'node:crypto';

import type { AiContext, AiModel, AiSkillKey } from './types';

/**
 * Request-hash + dedup helpers for the Claude SDK adapter
 * (Phase 7 / Commit 22).
 *
 * Two layers of caching coexist:
 *
 *   1. **Anthropic prompt cache** (~5-min TTL, 90% discount on
 *      cached input tokens) — Phase 11's real adapter wires
 *      `cache_control: { type: 'ephemeral' }` to long system
 *      prompts. Mock doesn't actually cache but reports
 *      `cachedInputTokens` heuristically.
 *
 *   2. **Dedup window** (this file, 5 min by default) — same
 *      `(orgId, requestHash)` inside the window returns the
 *      previous output without a fresh model call. Catches "user
 *      clicks Sugerir Respuesta twice" + "same compliance check
 *      submitted twice".
 *
 * Implementation strategy:
 *
 *   - In-process LRU as the fast path (sub-millisecond hit).
 *   - DB lookup (`ai_generations` by `requestHash`) as the cross-
 *     process fallback. The adapter is the only writer; readers
 *     can trust the row.
 */

const DEDUP_WINDOW_MS = 5 * 60_000;
const LRU_MAX_ENTRIES = 256;

// ---------------------------------------------------------------------------
// Canonical hash
// ---------------------------------------------------------------------------

/**
 * Stable sha256 of every field that participates in the result.
 * Same input → same hash → dedup eligible.
 *
 * `JSON.stringify` is unstable for objects with non-sorted keys;
 * we canonicalize via `canonicalJson` (recursive key sort).
 */
export function computeRequestHash(input: {
  skill: AiSkillKey;
  model: AiModel;
  systemPrompt: string;
  userPrompt: string;
  input: unknown;
  promptVersion: string;
}): string {
  const payload = [
    input.skill,
    input.model,
    input.promptVersion,
    input.systemPrompt,
    input.userPrompt,
    canonicalJson(input.input),
  ].join('\n---\n');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') +
    '}'
  );
}

// ---------------------------------------------------------------------------
// In-process LRU for fast same-process dedup
// ---------------------------------------------------------------------------

interface CacheEntry {
  readonly output: unknown;
  readonly insertedAt: number;
}

/**
 * Tiny insertion-ordered LRU. `Map` preserves insertion order, so
 * deleting + re-inserting the most-recently-accessed key moves it
 * to the tail; the head is the eviction target.
 */
class LruCache {
  private store = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    // Move to tail (most recent).
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  set(key: string, output: unknown): void {
    if (this.store.has(key)) this.store.delete(key);
    this.store.set(key, { output, insertedAt: Date.now() });
    while (this.store.size > LRU_MAX_ENTRIES) {
      const first = this.store.keys().next().value;
      if (first === undefined) break;
      this.store.delete(first);
    }
  }

  /** Test seam. */
  clear(): void {
    this.store.clear();
  }

  /** Test seam — current entry count. */
  size(): number {
    return this.store.size;
  }
}

const lru = new LruCache();

/**
 * In-process dedup lookup. Returns the cached output when:
 *
 *   - Same `(orgId, requestHash)` is in the LRU AND
 *   - the cached entry is younger than the dedup window.
 *
 * The org segment in the cache key prevents cross-tenant leaks
 * even if two orgs happen to compute the same request hash for
 * generic prompts.
 */
export function getCached(
  ctx: Pick<AiContext, 'orgId'>,
  requestHash: string,
): unknown | undefined {
  const key = `${ctx.orgId}|${requestHash}`;
  const entry = lru.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.insertedAt > DEDUP_WINDOW_MS) {
    return undefined;
  }
  return entry.output;
}

export function setCached(
  ctx: Pick<AiContext, 'orgId'>,
  requestHash: string,
  output: unknown,
): void {
  lru.set(`${ctx.orgId}|${requestHash}`, output);
}

// Test seams
export function _clearLruForTests(): void {
  lru.clear();
}

export function _lruSizeForTests(): number {
  return lru.size();
}

export const DEDUP_WINDOW_MS_EXPORT = DEDUP_WINDOW_MS;
