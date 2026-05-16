/**
 * Composite cursor for /reviews pagination.
 *
 * The list orders by `(posted_at DESC, id DESC)` so the cursor packs
 * both — `posted_at` is the primary sort, `id` is the tie-breaker. Same
 * structure and fault-tolerant decode posture as the inbox cursor
 * (Commit 8): malformed input degrades to "start from the top" rather
 * than 500.
 *
 * Cursor format: `base64url(JSON.stringify({ t, i }))` where `t` is an
 * ISO-8601 UTC timestamp of the row's `posted_at` and `i` is its UUID.
 * The pagination predicate is the tuple comparison
 * `(posted_at, id) < (cursor.t, cursor.i)` which Postgres compiles to
 * an index range scan on `reviews_org_posted_idx`.
 *
 * INVALIDATION (Ajuste 3): when the user changes the date range, the
 * client deletes the `cursor` URL param before pushing — otherwise a
 * cursor referencing a `posted_at` outside the new range silently
 * returns zero rows and feels like a bug. The server-side filter
 * layer doesn't try to re-validate the cursor against the range; the
 * client owns that invariant.
 */
import { log } from '../log';

export interface ReviewCursor {
  /** ISO-8601 timestamp of the review's `posted_at`. */
  readonly t: string;
  /** Review UUID — tie-breaker when `t` ties. */
  readonly i: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeReviewCursor(c: ReviewCursor): string {
  const payload = JSON.stringify({ t: c.t, i: c.i });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decode an untrusted cursor string. Returns null on any failure — the
 * caller treats null as "no cursor". Every reject logs as
 * `reviews.cursor.malformed` so the same observability dashboards that
 * watch inbox cursors light up for reviews too.
 */
export function decodeReviewCursor(raw: string | null | undefined): ReviewCursor | null {
  if (!raw) return null;
  if (raw.length > 256) {
    log.warn({ raw: raw.slice(0, 64), len: raw.length }, 'reviews.cursor.malformed');
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    log.warn({ raw }, 'reviews.cursor.malformed');
    return null;
  }
  if (!decoded) {
    log.warn({ raw }, 'reviews.cursor.malformed');
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    log.warn({ raw }, 'reviews.cursor.malformed');
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { t?: unknown }).t !== 'string' ||
    typeof (parsed as { i?: unknown }).i !== 'string'
  ) {
    log.warn({ raw }, 'reviews.cursor.malformed');
    return null;
  }
  const { t, i } = parsed as { t: string; i: string };
  if (!UUID_RE.test(i)) {
    log.warn({ raw }, 'reviews.cursor.malformed');
    return null;
  }
  const ts = Date.parse(t);
  if (Number.isNaN(ts)) {
    log.warn({ raw }, 'reviews.cursor.malformed');
    return null;
  }
  return { t, i };
}
