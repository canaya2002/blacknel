/**
 * Composite cursor for inbox-thread pagination.
 *
 * The list is ordered by `(last_message_at DESC, id DESC)` so a single
 * cursor needs both components — `last_message_at` is the primary sort
 * key, `id` is the deterministic tie-breaker. Encoding as base64 of a
 * tiny JSON object keeps URLs portable and human-glanceable in logs.
 *
 * Cursor format: `base64url(JSON.stringify({ t, i }))` where `t` is
 * ISO-8601 (UTC) and `i` is a UUID. Pagination predicate is the tuple
 * comparison `(last_message_at, id) < (cursor.t, cursor.i)` — Postgres
 * optimizes that to a clean index scan on `inbox_threads_org_last_message_idx`.
 *
 * Decoding is fault-tolerant. A malformed cursor logs a `warn` event
 * and returns null so the request degrades to "start from the top"
 * instead of 500-ing — typical UX after a manual URL edit.
 */
import { log } from '../log';

export interface ThreadCursor {
  /** ISO-8601 timestamp of the thread's last message. */
  readonly t: string;
  /** Thread UUID, used as tie-breaker when `t` ties. */
  readonly i: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeThreadCursor(c: ThreadCursor): string {
  const payload = JSON.stringify({ t: c.t, i: c.i });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decode an untrusted cursor string. Returns null on any failure —
 * the caller treats null as "no cursor". Logs every rejected cursor as
 * `inbox.cursor.malformed` with the raw value so we can spot phishing
 * or replay attempts in observability.
 */
export function decodeThreadCursor(raw: string | null | undefined): ThreadCursor | null {
  if (!raw) return null;
  if (raw.length > 256) {
    log.warn({ raw: raw.slice(0, 64), len: raw.length }, 'inbox.cursor.malformed');
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    log.warn({ raw }, 'inbox.cursor.malformed');
    return null;
  }
  if (!decoded) {
    log.warn({ raw }, 'inbox.cursor.malformed');
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    log.warn({ raw }, 'inbox.cursor.malformed');
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { t?: unknown }).t !== 'string' ||
    typeof (parsed as { i?: unknown }).i !== 'string'
  ) {
    log.warn({ raw }, 'inbox.cursor.malformed');
    return null;
  }
  const { t, i } = parsed as { t: string; i: string };
  if (!UUID_RE.test(i)) {
    log.warn({ raw }, 'inbox.cursor.malformed');
    return null;
  }
  const ts = Date.parse(t);
  if (Number.isNaN(ts)) {
    log.warn({ raw }, 'inbox.cursor.malformed');
    return null;
  }
  return { t, i };
}
