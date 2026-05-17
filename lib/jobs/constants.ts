/**
 * Constants shared between server-only publish-job modules AND the
 * Client surface (composer banners, post-list-row retry chip). The
 * latter goes through the React Client boundary so it can't import
 * `lib/jobs/publish-target.ts` directly (that file is
 * `'server-only'` and refuses the transitive Client bundle).
 *
 * Single source of truth:
 *
 *   - `MAX_RETRY_COUNT` — the publish-job's retry cap (3).
 *   - `BACKOFF_MS`      — `[60s, 300s, 900s]` post-failure backoff.
 *
 * Both are re-exported from `publish-target.ts` for backward
 * compatibility — existing server-side imports keep working.
 */

export const MAX_RETRY_COUNT = 3;

export const BACKOFF_MS: ReadonlyArray<number> = [60_000, 300_000, 900_000];
