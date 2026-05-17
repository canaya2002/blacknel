/**
 * Composite cursor for /publish post list pagination (Commit 21).
 *
 * The list is ordered by `(created_at DESC, id DESC)`. A single
 * cursor needs both components — `created_at` is the primary key,
 * `id` is the deterministic tie-breaker. Pagination predicate is
 * `(created_at, id) < (cursor.t, cursor.i)`. Same shape as
 * inbox/cursor.ts and approvals/cursor.ts.
 *
 * Decoding is fault-tolerant. A malformed cursor logs `warn` and
 * returns null so the request degrades to "start from the top"
 * instead of 500-ing.
 */
import { log } from '../log';

export interface PostCursor {
  /** ISO-8601 timestamp of the post's `created_at`. */
  readonly t: string;
  /** Post UUID, used as tie-breaker when `t` ties. */
  readonly i: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodePostCursor(c: PostCursor): string {
  const payload = JSON.stringify({ t: c.t, i: c.i });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodePostCursor(raw: string | null | undefined): PostCursor | null {
  if (!raw) return null;
  if (raw.length > 256) {
    log.warn({ raw: raw.slice(0, 64), len: raw.length }, 'post.cursor.malformed');
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    log.warn({ raw }, 'post.cursor.malformed');
    return null;
  }
  if (!decoded) {
    log.warn({ raw }, 'post.cursor.malformed');
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    log.warn({ raw }, 'post.cursor.malformed');
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { t?: unknown }).t !== 'string' ||
    typeof (parsed as { i?: unknown }).i !== 'string'
  ) {
    log.warn({ raw }, 'post.cursor.malformed');
    return null;
  }
  const { t, i } = parsed as { t: string; i: string };
  if (!UUID_RE.test(i)) {
    log.warn({ raw }, 'post.cursor.malformed');
    return null;
  }
  if (Number.isNaN(Date.parse(t))) {
    log.warn({ raw }, 'post.cursor.malformed');
    return null;
  }
  return { t, i };
}
