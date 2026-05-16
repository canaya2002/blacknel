/**
 * Composite cursor for approval-queue pagination. Same shape and
 * tolerances as `lib/inbox/cursor.ts` — kept separate so divergence
 * (e.g. if we sort approvals by risk + created_at later) doesn't have
 * to refactor inbox at the same time.
 *
 * Sort key for the approvals list is `(created_at DESC, id DESC)` —
 * the cursor encodes both. Decoding is fault-tolerant: any failure
 * returns null and the caller treats it as "start from the top",
 * logging the rejection for observability.
 */
import { log } from '../log';

export interface ApprovalCursor {
  /** ISO-8601 timestamp of the approval's created_at. */
  readonly t: string;
  /** Approval UUID, used as tie-breaker when `t` ties. */
  readonly i: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeApprovalCursor(c: ApprovalCursor): string {
  const payload = JSON.stringify({ t: c.t, i: c.i });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeApprovalCursor(raw: string | null | undefined): ApprovalCursor | null {
  if (!raw) return null;
  if (raw.length > 256) {
    log.warn({ raw: raw.slice(0, 64), len: raw.length }, 'approvals.cursor.malformed');
    return null;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    log.warn({ raw }, 'approvals.cursor.malformed');
    return null;
  }
  if (!decoded) {
    log.warn({ raw }, 'approvals.cursor.malformed');
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    log.warn({ raw }, 'approvals.cursor.malformed');
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { t?: unknown }).t !== 'string' ||
    typeof (parsed as { i?: unknown }).i !== 'string'
  ) {
    log.warn({ raw }, 'approvals.cursor.malformed');
    return null;
  }
  const { t, i } = parsed as { t: string; i: string };
  if (!UUID_RE.test(i)) {
    log.warn({ raw }, 'approvals.cursor.malformed');
    return null;
  }
  const ts = Date.parse(t);
  if (Number.isNaN(ts)) {
    log.warn({ raw }, 'approvals.cursor.malformed');
    return null;
  }
  return { t, i };
}
